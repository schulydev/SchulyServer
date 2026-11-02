# Helply's sandbox sidecar. Build context is ./src, like the API image:
#   docker build -f src/Schuly.Sandbox/Dockerfile src
#
# Everything is pinned to an exact version and digest. microsandbox is beta software, so an upgrade is a deliberate change
# that is reviewed and re-tested (its CLI flags have changed between minor versions), never pulled in implicitly.
ARG MICROSANDBOX_IMAGE=ghcr.io/superradcompany/microsandbox:0.7.4@sha256:333e0240130977ac41fbe8b321f3813a137b2b72891cf133d1200419e8974e60
ARG SANDBOX_BASE=python:3.13.18-slim@sha256:ae14d4ce8771606477a81446e7ef429edd6762305fc50c84507c1041fa8285d1
ARG CRANE_IMAGE=gcr.io/go-containerregistry/crane:debug@sha256:e78770b31258a3846f878036d9c1f63fbe4c871f9f56990bf77fd95c013e3c1b

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG VERSION=1.0.0
WORKDIR /src
COPY ["Schuly.Sandbox/Schuly.Sandbox.csproj", "Schuly.Sandbox/"]
RUN dotnet restore "Schuly.Sandbox/Schuly.Sandbox.csproj" -r linux-x64
COPY Schuly.Sandbox/ Schuly.Sandbox/
RUN dotnet publish "Schuly.Sandbox/Schuly.Sandbox.csproj" -c Release -r linux-x64 --self-contained -o /app --no-restore -p:Version=$VERSION

# The image every sandbox boots: Python plus the libraries grade analysis and charts reach for. The packages go into a layer of
# their own that crane appends to the base, writing an OCI archive the sidecar loads into msb at first use: no registry to publish
# to and no docker inside the build.
FROM ${SANDBOX_BASE} AS sandbox-packages
# Pinned so every build of a release produces the same sandbox; bump them deliberately.
RUN pip install --no-cache-dir --root /layer pandas==3.0.6 numpy==2.5.3 openpyxl==3.1.5 pypdf==6.19.0 pdfplumber==0.11.10 matplotlib==3.11.2 \
    && tar -C /layer -cf /layer.tar .

FROM ${CRANE_IMAGE} AS sandbox-image
ARG SANDBOX_BASE
SHELL ["/busybox/sh", "-c"]
COPY --from=sandbox-packages /layer.tar /layer.tar
RUN crane append --platform linux/amd64 --base "${SANDBOX_BASE}" --new_layer /layer.tar --new_tag schuly-sandbox --output /image.tar

FROM ${MICROSANDBOX_IMAGE} AS final
WORKDIR /app
COPY --from=build /app .
COPY --from=sandbox-image /image.tar /opt/sandbox-image.tar
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["/app/Schuly.Sandbox"]
