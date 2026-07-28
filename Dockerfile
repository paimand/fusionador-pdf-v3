FROM node:18-slim

# Instalar Ghostscript y dependencias del sistema operativo
RUN apt-get update && apt-get install -y \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar manifiesto de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --production

# Copiar todo el código del proyecto
COPY . .

# Crear directorio de trabajo temporal para uploads
RUN mkdir -p uploads

EXPOSE 3000

CMD ["npm", "start"]
