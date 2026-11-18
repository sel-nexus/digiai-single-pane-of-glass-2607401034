"""Parse bounded CSV and first-sheet XLSX without evaluating cells or extracting files."""
import csv
import io
import posixpath
import re
import zipfile
from xml.etree.ElementTree import ParseError
from defusedxml.ElementTree import fromstring
from defusedxml.common import DefusedXmlException
from app.core.config import Settings
from app.schemas.uploads import UploadFailure, UploadIssue

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def reject(message: str, code: str = 'PARSE_ERROR') -> UploadFailure:
    """Create a safe parser rejection with an actionable issue."""
    return UploadFailure(422, 'UPLOAD_REJECTED', message, [UploadIssue(code=code, message=message)])


def checked_rows(rows: list[list[str]], config: Settings) -> tuple[list[str], list[list[str]]]:
    """Validate nonempty unique headers and rectangular data within configured bounds."""
    if not rows or not rows[0] or any(not item or len(item) > 200 for item in rows[0]):
        raise reject('Supply a header row with nonempty column names.')
    headers = rows[0]
    if len(headers) != len(set(headers)):
        raise reject('Header names must be unique.')
    if len(headers) > config.upload_max_columns or len(rows) - 1 > config.upload_max_rows:
        raise UploadFailure(413, 'UPLOAD_LIMIT', 'The row or column limit was exceeded.')
    if len(rows) < 2:
        raise reject('Supply at least one data row.')
    if any(len(row) != len(headers) for row in rows[1:]):
        raise reject('Every data row must match the header column count.')
    return headers, rows[1:]


def parse_csv(data: bytes, config: Settings) -> tuple[list[str], list[list[str]]]:
    """Read UTF-8 comma-separated cells using strict quoting and incremental limits."""
    try:
        text = data.decode('utf-8-sig')
        if '\x00' in text:
            raise reject('CSV cannot contain NUL characters.')
        rows = []
        for row in csv.reader(io.StringIO(text, newline=''), strict=True):
            if len(row) > config.upload_max_columns or len(rows) > config.upload_max_rows:
                raise UploadFailure(413, 'UPLOAD_LIMIT', 'The row or column limit was exceeded.')
            rows.append(row)
        return checked_rows(rows, config)
    except (UnicodeDecodeError, csv.Error) as error:
        raise reject('CSV must be valid UTF-8 with well-formed quoted cells.') from error


def parse_xlsx(data: bytes, config: Settings) -> tuple[list[str], list[list[str]]]:
    """Read safe OOXML cell text, reject formulas and bound expanded archive size."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > 1000 or sum(info.file_size for info in infos) > config.xlsx_max_expanded_bytes:
                raise UploadFailure(413, 'UPLOAD_LIMIT', 'XLSX expanded archive limit exceeded.')
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or any(name.startswith('/') or '\\' in name or '..' in name.split('/') or info.flag_bits & 1 for name, info in zip(names, infos)):
                raise reject('XLSX contains unsafe or duplicate archive entries.')
            payload = {}
            total = 0
            for info in infos:
                with archive.open(info) as stream:
                    content = stream.read(config.xlsx_max_expanded_bytes - total + 1)
                total += len(content)
                if total > config.xlsx_max_expanded_bytes:
                    raise UploadFailure(413, 'UPLOAD_LIMIT', 'XLSX expanded archive limit exceeded.')
                if info.filename.endswith(('.xml', '.rels')):
                    root = fromstring(content, forbid_dtd=True, forbid_entities=True, forbid_external=True)
                    if any(node.tag == NS + 'f' for node in root.iter()):
                        raise reject('Formula cells are not accepted; supply literal values.', 'FORMULA_CELL')
                    payload[info.filename] = root
            workbook = payload['xl/workbook.xml']
            sheets = workbook.find(NS + 'sheets')
            if sheets is None or not len(sheets):
                raise reject('XLSX has no first worksheet.')
            relations = payload['xl/_rels/workbook.xml.rels']
            link = next(node for node in relations if node.get('Id') == sheets[0].get(REL))
            if link.get('TargetMode') == 'External':
                raise reject('External worksheets are not accepted.')
            target = link.get('Target', '')
            sheet_name = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join('xl', target))
            if not sheet_name.startswith('xl/worksheets/'):
                raise reject('First sheet must be an internal worksheet.')
            strings = []
            if 'xl/sharedStrings.xml' in payload:
                strings = [''.join(item.text or '' for item in node.iter(NS + 't')) for node in payload['xl/sharedStrings.xml']]
            sheet = payload[sheet_name]
            rows = []
            previous_row = 0
            for row in sheet.findall('.//' + NS + 'sheetData/' + NS + 'row'):
                row_number = int(row.get('r', str(previous_row + 1)))
                if row_number != previous_row + 1:
                    raise reject('Worksheet rows must be contiguous from the header.')
                previous_row = row_number
                if row_number > config.upload_max_rows + 1:
                    raise UploadFailure(413, 'UPLOAD_LIMIT', 'Worksheet row limit exceeded.')
                cells = {}
                for cell in row:
                    match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', cell.get('r', ''))
                    if not match or int(match[2]) != row_number:
                        raise reject('Invalid worksheet cell reference.')
                    column = 0
                    for char in match[1]:
                        column = column * 26 + ord(char) - 64
                    if column > config.upload_max_columns:
                        raise UploadFailure(413, 'UPLOAD_LIMIT', 'Worksheet column limit exceeded.')
                    if column in cells:
                        raise reject('Duplicate worksheet cell reference.')
                    kind = cell.get('t', 'n')
                    value = cell.findtext(NS + 'v', '')
                    if kind == 's':
                        value = strings[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(node.text or '' for node in cell.iter(NS + 't'))
                    elif kind not in ('n', 'str'):
                        raise reject('Use text or numeric literal cells, not boolean/error/date cells.')
                    cells[column] = value
                width = len(rows[0]) if rows else max(cells, default=0)
                if max(cells, default=0) > width:
                    raise reject('Data cells extend beyond the header.')
                rows.append([cells.get(index, '') for index in range(1, width + 1)])
            return checked_rows(rows, config)
    except (zipfile.BadZipFile, KeyError, IndexError, ValueError, StopIteration, ParseError, DefusedXmlException, RuntimeError, NotImplementedError) as error:
        raise reject('XLSX must be a valid safe workbook with an internal first worksheet.') from error


def parse_file(data: bytes, filename: str, config: Settings) -> tuple[list[str], list[list[str]]]:
    """Dispatch only supported file containers, never trusting client MIME alone."""
    if len(data) > config.upload_max_bytes:
        raise UploadFailure(413, 'UPLOAD_LIMIT', 'Upload byte limit exceeded.')
    extension = filename.rsplit('.', 1)[-1].lower()
    if extension == 'csv':
        if data.startswith((b'PK', b'\xd0\xcf', b'%PDF')):
            raise UploadFailure(415, 'UNSUPPORTED_FILE', 'CSV requires UTF-8 text, not a binary container.')
        return parse_csv(data, config)
    if extension == 'xlsx':
        if not data.startswith(b'PK'):
            raise UploadFailure(415, 'UNSUPPORTED_FILE', 'XLSX requires an OOXML ZIP workbook.')
        return parse_xlsx(data, config)
    raise UploadFailure(415, 'UNSUPPORTED_FILE', 'Select a CSV or XLSX file.')
