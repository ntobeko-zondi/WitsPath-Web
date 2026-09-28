# WitsPath routing service for Google Cloud Run.
# Build context: the repository root (the tests need public/data):
#   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/witspath/routing -f routing/Dockerfile .
# or build locally:
#   docker build -f routing/Dockerfile -t witspath-routing .

FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY routing/ routing/
COPY public/data/wits-west-map.json public/data/wits-west-map.json
RUN sh routing/build.sh

FROM eclipse-temurin:17-jre
RUN useradd --system --no-create-home routing
USER routing
COPY --from=build /src/routing/build/witspath-routing.jar /app/witspath-routing.jar
# Cloud Run provides PORT; the service defaults to 8081 otherwise.
ENV PORT=8080
EXPOSE 8080
CMD ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/witspath-routing.jar"]
