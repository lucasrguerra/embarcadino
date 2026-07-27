FROM searxng/searxng:latest

# Embutir a configuração na imagem para não depender de bind mounts.
# O Coolify executa o compose dentro de um helper container; bind mounts
# resolvem contra o host, onde o repo não existe, criando pastas vazias.
COPY settings.yml /etc/searxng/settings.yml
