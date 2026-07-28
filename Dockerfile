FROM node:20-alpine

WORKDIR /app

# Copiar manifiesto de dependencias
COPY package*.json ./

# Instalar todas las dependencias necesarias
RUN npm install

# Copiar todo el código del proyecto
COPY . .

# Crear carpetas temporales para el procesamiento de archivos
RUN mkdir -p tmp/uploads tmp/outputs

EXPOSE 3000

CMD ["npm", "start"]
