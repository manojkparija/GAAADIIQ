FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# --retries/--timeout because this line is what failed the deploy of 2026-10-04:
#
#   BrokenPipeError(32, 'Broken pipe')
#   ProtocolError: ("Connection broken: BrokenPipeError(32, 'Broken pipe')")
#   error: ... "pip install --no-cache-dir -r requirements.txt" did not
#   complete successfully: exit code: 2
#
# The connection dropped partway through a download. requirements.txt had not
# changed since #239 and CI installed the same file twice on that commit, so
# nothing about the dependency set was wrong — one packet of bad luck failed a
# whole build, and the previous instance kept serving because the new one never
# came up.
#
# pip's default is 5 retries with a 15-second timeout, and those apply to
# establishing a connection rather than to one that dies mid-transfer. Raising
# both gives a dropped transfer room to be retried inside the build instead of
# ending it.
#
# This makes the failure rarer, not impossible. A build that fails this way
# again is still a retry in Render, not a code change.
RUN pip install --no-cache-dir --retries 10 --timeout 60 -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
