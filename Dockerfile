# Usa la imagen oficial de Node.js en su versión LTS sobre Debian Bookworm
FROM node:18-bookworm-slim

# Instala las herramientas nativas necesarias: qpdf y ghostscript
RUN apt-get update && \
    apt-get install -y --no-install-recommends qpdf ghostscript && \
    rm -rf /var/lib/apt/lists/*

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de definición de dependencias
COPY package*.json ./

# Instala únicamente las dependencias de producción
RUN npm ci --only=production

# Copia el resto del código fuente del proyecto
COPY . .

# Expone el puerto por defecto de la aplicación
EXPOSE 3000

# Comando para iniciar el servidor
CMD ["npm", "start"]
