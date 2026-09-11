# Minimal Data API Builder container for Azure Container Apps
FROM mcr.microsoft.com/azure-databases/data-api-builder:latest

# Copy DAB configuration file into container workdir (/App)
COPY dab-config.json /App/dab-config.json

# Default port for Data API Builder
EXPOSE 5000
