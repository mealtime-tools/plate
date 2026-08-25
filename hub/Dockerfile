# The self-hosted index. Build from the repository root:
#   docker build -f hub/Dockerfile -t recipes-index .
#
# The collection is mounted at /recipes, never copied in: recipes are private
# data, and baking them into an image would freeze the page at build time.
FROM oven/bun:1-alpine

WORKDIR /app

# Copied file by file, for the same reason `pages.yml` lists what it deploys:
# the image then holds the runtime and nothing else -- no tests, no .git.
COPY index.html style.css app.mjs recipe.mjs nutrients.json ./
COPY hub/index.html hub/hub.css hub/app.mjs hub/catalogue.mjs hub/collection.mjs hub/serve.mjs ./hub/

ENV RECIPES_DIR=/recipes \
    PORT=8080

EXPOSE 8080
USER bun
CMD ["bun", "hub/serve.mjs"]
