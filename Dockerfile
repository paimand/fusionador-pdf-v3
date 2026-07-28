# 1. Imagen base oficial de Node.js (Debian Bookworm LTS)
FROM node:20-bookworm-slim

# Evita avisos interactivos de debconf durante el build de apt
ENV DEBIAN_FRONTEND=noninteractive

# 2. Instalar herramientas nativas de manipulación y compresión de PDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    qpdf \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# 4. Copiar los archivos de configuración de dependencias
# IMPORTANTE: package-lock.json debe estar subido a tu repositorio Git
COPY package*.json ./

# 5. Instalación limpia de dependencias de producción utilizando npm ci
RUN npm install --omit=dev

# 6. Copiar el resto del código fuente
COPY . .

# 7. Crear directorios temporales necesarios con permisos adecuados
RUN mkdir -p tmp/uploads tmp/outputs

# 8. Expone el puerto del servidor (Render asigna procesando el env PORT)
EXPOSE 3000

# 9. Comando de inicio de la aplicación
CMD ["npm", "start"]
