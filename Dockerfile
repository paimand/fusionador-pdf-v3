FROM node:20-alpine

WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar dependencias declaradas
RUN npm install

# Copiar el código fuente completo
COPY . .

# Crear carpetas temporales de trabajo
RUN mkdir -p tmp/uploads tmp/outputs

EXPOSE 3000

CMD ["npm", "start"]
