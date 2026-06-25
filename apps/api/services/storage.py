import uuid
from typing import BinaryIO

import boto3
from botocore.config import Config

from core.config import settings


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_image(file: BinaryIO, content_type: str, folder: str = "listings") -> str:
    key = f"{folder}/{uuid.uuid4()}"
    _r2_client().upload_fileobj(
        file,
        settings.r2_bucket_name,
        key,
        ExtraArgs={"ContentType": content_type, "ACL": "public-read"},
    )
    return f"{settings.r2_public_url}/{key}"


def delete_image(url: str) -> None:
    key = url.removeprefix(f"{settings.r2_public_url}/")
    _r2_client().delete_object(Bucket=settings.r2_bucket_name, Key=key)
