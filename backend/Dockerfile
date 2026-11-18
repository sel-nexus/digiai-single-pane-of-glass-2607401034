FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV DATABASE_PATH=/data/digiai.db BIND_HOST=0.0.0.0 BIND_PORT=8000
RUN mkdir -p /data
EXPOSE 8000
CMD ["python", "-m", "app.main"]
