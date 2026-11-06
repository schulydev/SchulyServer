FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
USER $APP_UID
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM --platform=$BUILDPLATFORM oven/bun:1.3.5 AS bun

FROM --platform=$BUILDPLATFORM node:24-slim AS frontend
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /frontend
COPY Schuly.Frontend/package.json Schuly.Frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY Schuly.Frontend .
RUN bun run build

# Compiled once on the runner's own platform: the output is framework-dependent and has no app host, so the same DLLs
# run on amd64 and arm64. Building this stage per platform made arm64 compile under QEMU, about 8x slower.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS publish
ARG BUILD_CONFIGURATION=Release
ARG VERSION=1.0.0
WORKDIR /src
COPY ["Schuly.API/Schuly.API.csproj", "Schuly.API/"]
RUN dotnet restore "./Schuly.API/Schuly.API.csproj"
COPY . .
WORKDIR "/src/Schuly.API"
RUN dotnet publish "./Schuly.API.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false -p:Version=$VERSION

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
COPY --from=frontend /frontend/dist/Schuly.Frontend/browser ./wwwroot
# Plugins are dropped into /app/plugins/<Name>.dll.
# Each plugin's runtime config lives at /app/plugins-config/<AssemblyName>.yml.
USER root
RUN mkdir -p /app/plugins /app/plugins-config && chown -R $APP_UID:$APP_UID /app/plugins /app/plugins-config
USER $APP_UID
ENTRYPOINT ["dotnet", "Schuly.API.dll"]