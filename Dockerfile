FROM node:18-slim

# Instalar Ghostscript
RUN apt-get update && apt-get install -y \
    ghostscript \
    && chmod +x /usr/bin/gs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar manifiesto de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install --production

# Copiar el proyecto
COPY . .

# Crear carpeta de trabajo temporal
RUN mkdir -p uploads && chmod 777 uploads

EXPOSE 3000

CMD ["npm", "start"]
