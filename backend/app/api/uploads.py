"""Adapt multipart uploads to the typed bounded ingestion service."""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from app.domain.upload_service import UploadService, load_object
from app.schemas.contracts import ProblemEnvelope
from app.schemas.uploads import DATASET_CLASSES, UploadActor, UploadEnvelope, UploadFailure, UploadIssue, UploadMapping

router = APIRouter(prefix='/api/v1/admin', tags=['uploads'])


def get_service(request: Request) -> UploadService:
    """Resolve the lifespan-initialized file-backed ingestion boundary."""
    return request.app.state.upload_service


@router.post('/uploads', response_model=UploadEnvelope, status_code=201, responses={status: {'model': ProblemEnvelope} for status in (400, 413, 415, 422, 503)}, summary='Explicitly ingest a bounded mapped demo dataset')
async def upload(request: Request) -> UploadEnvelope | JSONResponse:
    """Validate the multipart envelope, then offload parsing and SQLite work."""
    service = get_service(request)
    try:
        if not request.headers.get('content-type', '').startswith('multipart/form-data;'):
            raise UploadFailure(400, 'INVALID_ENVELOPE', 'Submit multipart file, datasetClass, mapping and actor fields.')
        # Bound the entire wire body before Starlette can spool an oversized file.
        chunks = []
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > service.config.upload_max_bytes + 262144:
                raise UploadFailure(413, 'UPLOAD_LIMIT', 'Multipart request exceeds the configured file limit plus envelope allowance.')
            chunks.append(chunk)
        body = b''.join(chunks)

        async def receive_body() -> dict:
            """Replay the bounded body to the standard multipart parser."""
            return {'type': 'http.request', 'body': body, 'more_body': False}

        bounded_request = Request(request.scope, receive_body)
        async with bounded_request.form(max_files=1, max_fields=3, max_part_size=65536) as form:
            if set(form) != {'file', 'datasetClass', 'mapping', 'actor'} or len(form.multi_items()) != 4:
                raise UploadFailure(400, 'INVALID_ENVELOPE', 'Supply exactly file, datasetClass, mapping and actor once each.')
            file = form['file']
            if not isinstance(file, UploadFile) or any(not isinstance(form[key], str) for key in ('datasetClass', 'mapping', 'actor')):
                raise UploadFailure(400, 'INVALID_ENVELOPE', 'File must be a file part; class, mapping and actor must be text parts.')
            if form['datasetClass'] not in DATASET_CLASSES:
                raise UploadFailure(400, 'INVALID_ENVELOPE', 'Select one of the eleven supported dataset classes.')
            try:
                mapping = UploadMapping.model_validate(load_object(form['mapping']))
                actor = UploadActor.model_validate(load_object(form['actor']))
            except (ValueError, ValidationError, RecursionError) as error:
                raise UploadFailure(400, 'INVALID_MAPPING', 'Mapping and actor must follow the documented JSON contract.', [UploadIssue(code='MAPPING_JSON', message='Use recordKind plus source-column-to-target columns, and actor personaId.')]) from error
            data = await file.read(service.config.upload_max_bytes + 1)
            result = await run_in_threadpool(service.accept, form['datasetClass'], data, file.filename or '', mapping, actor)
        if result.data.outcome == 'unconfirmed':
            return JSONResponse(status_code=503, content=result.model_dump())
        return result
    except UploadFailure as error:
        details = {'issues': [issue.model_dump(exclude_none=True) for issue in error.issues]}
        if error.code == 'STORAGE_UNAVAILABLE':
            details['commitStatus'] = 'not_committed'
        return JSONResponse(status_code=error.status, content={'error': {'code': error.code, 'message': str(error), 'details': details}})
