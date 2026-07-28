FROM node:18-slim

# Instalar qpdf en el sistema operativo del contenedor
RUN apt-get update && apt-get install -y qpdf && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar paquetes e instalar dependencias
COPY package*.json ./
RUN npm install

# Copiar todo el código de la aplicación
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
