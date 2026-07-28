# Imagen base oficial de Node.js en Debian (Bookworm)
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Instalar herramientas del sistema necesarias para la compresión y manipulación de PDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    qpdf \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar todas las dependencias
RUN npm install

# Copiar el código de la aplicación
COPY . .

# Crear carpetas temporales para subidas y salidas
RUN mkdir -p tmp/uploads tmp/outputs

EXPOSE 3000

CMD ["npm", "start"]
