// Simuladores de provedores contratados (voz neural e Power BI) para os testes. Credenciais fictícias.
import http from "node:http";
export const TTS_KEY = "tts-chave-ficticia", PBI = { tenant: "tenant-ficticio", client: "cliente-ficticio", secret: "segredo-ficticio", ws: "ws1", report: "rep1", dataset: "ds1" };
export const seen = { gen: [] };
export function start(port = 9915) {
  return new Promise(res => { const s = http.createServer((q, r) => {
    let b = ""; q.on("data", c => b += c); q.on("end", () => {
      const send = (st, j) => { r.writeHead(st, { "Content-Type": "application/json" }); r.end(JSON.stringify(j)); };
      if (q.method === "POST" && q.url === "/v1/text:synthesize") return q.headers["x-goog-api-key"] === TTS_KEY ? send(200, { audioContent: Buffer.from("ID3-audio-ficticio").toString("base64") }) : send(403, {});
      if (q.method === "POST" && q.url === `/${PBI.tenant}/oauth2/v2.0/token`) { const f = new URLSearchParams(b);
        return f.get("client_secret") === PBI.secret && f.get("grant_type") === "client_credentials" ? send(200, { access_token: "aad-ficticio" }) : send(401, {}); }
      if (q.headers.authorization !== "Bearer aad-ficticio") return send(401, {});
      if (q.method === "GET" && q.url === `/v1.0/myorg/groups/${PBI.ws}/reports/${PBI.report}`) return send(200, { id: PBI.report, embedUrl: `https://app.powerbi.com/reportEmbed?reportId=${PBI.report}`, datasetId: PBI.dataset });
      if (q.method === "POST" && q.url === `/v1.0/myorg/groups/${PBI.ws}/reports/${PBI.report}/GenerateToken`) { const j = JSON.parse(b); seen.gen.push(j); return send(200, { token: "emb-" + j.identities[0].username, expiration: "2030-01-01T00:00:00Z" }); }
      send(404, {});
    }); }).listen(port, () => res(s)); });
}
