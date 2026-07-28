FROM node:18-slim

# Instalar Ghostscript y dependencias del sistema
RUN apt-get update && apt-get install -y \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install --production

# Copiar el resto del código del proyecto
COPY . .

# Crear carpeta temporal para subidas si no existe
RUN mkdir -p uploads

EXPOSE 3000

CMD ["npm", "start"]
