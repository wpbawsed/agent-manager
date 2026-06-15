FROM docker.io/cloudflare/sandbox:0.7.0

# Cloud agent runner — baked into the image so every sandbox can start an
# agent without downloading anything. The runner has the push APIs
# (heartbeat / metrics / logs) built in; see runner/push-client.js.
COPY runner /opt/agent-runner
RUN cd /opt/agent-runner && npm install --omit=dev

EXPOSE 8080
