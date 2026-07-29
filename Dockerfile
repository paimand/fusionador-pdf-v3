FROM node:18-slim

# Instalar qpdf para desproteger/limpiar PDFs bancarios o firmados
RUN apt-get update && apt-get install -y \
    qpdf \
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
