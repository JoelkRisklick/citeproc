import express from "express";
import { localeEnUS, normalizeCslItem } from "./locale.js";
import CSL from "citeproc";
import * as cheerio from "cheerio";
const app = express();
app.use(express.json({ limit: "1mb" }));

// Endpoint: /render-citations
// Expects body: { publicationsById, styleXml, [localeXml] }

app.post("/render-citations", async (req, res) => {
  try {
    const { publicationsById, styleXml, localeXml, html } = req.body;
    if (!publicationsById || !styleXml) {
      return res
        .status(400)
        .json({ error: "Missing publicationsById or styleXml" });
    }

    const sys = {
      retrieveItem(id) {
        const raw = publicationsById[id];
        if (!raw) return null;
        return normalizeCslItem(raw);
      },
      retrieveLocale(lang) {
        if (!lang.startsWith("en")) {
          throw new Error(
            `This CSL file requires locale "${lang}", but only "en-US" is currently supported.`
          );
        }
        return (localeXml || localeEnUS).replace(/^\uFEFF/, "");
      },
    };

    const engine = new CSL.Engine(sys, styleXml, "en-US", true);

    const $ = cheerio.load(html, {
      decodeEntities: true,
      xmlMode: false,
    });

    const allIds = new Set();

    $("citation").each((_, el) => {
      const raw = $(el).attr("data-ref-ids");
      if (!raw) return;

      try {
        const ids = JSON.parse(raw);
        ids.forEach((id) => allIds.add(id));
      } catch {}
    });

    // Inc case adding to database fails but citation stays in the editor. That id should not be send
    const validIds = [...allIds].filter((id) => publicationsById[id]);
    engine.updateItems([...validIds]);

    $("citation").each((_, el) => {
      const raw = $(el).attr("data-ref-ids");
      if (!raw) return;

      let refIds;
      try {
        refIds = JSON.parse(raw);
      } catch {
        return;
      }

      if (!Array.isArray(refIds) || refIds.length === 0) return;
      const validRefIds = refIds.filter((id) => publicationsById[id]);
      const rendered = engine.makeCitationCluster(
        validRefIds.map((id) => ({ id }))
      );

      const tooltip = validRefIds
        .map((id) => {
          const pub = publicationsById[id];
          if (!pub) return null;

          const author = pub.author?.[0]
            ? [pub.author[0].family, pub.author[0].given]
                .filter(Boolean)
                .join(", ")
            : "Unknown";

          const year = pub.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";

          return `${author} (${year}) — ${pub.title}`;
        })
        .filter(Boolean)
        .join("\n");

      $(el).attr("data-rendered", rendered);
      $(el).attr("data-tooltip", tooltip);
    });

    const sections = [];

    $("section[data-paragraph-id]").each((_, el) => {
      const paragraphId = $(el).attr("data-paragraph-id");
      if (!paragraphId) return;

      sections.push({
        paragraphId,
        html: $(el).html() ?? "",
      });
    });

    res.json({
      sections,
    });
    {
  // "sections": [
  //   {
  //     "paragraphId": "section-1-id",
  //     "html": "<p>Text with [1]</p>"
  //   },
  //   {
  //     "paragraphId": "section-2-id",
  //     "html": "<p>Text with [2,3]</p>"
  //   }
  // ]
}
  } catch (err) {
    console.error("Error in /create-csl-engine-once:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/render-bibliography", async (req, res) => {
  try {
    const { publications, styleXml } = req.body;
    if (!publications || !styleXml) {
      return res
        .status(400)
        .json({ error: "Missing publications or styleXml" });
    }

    const sys = {
      retrieveItem(id) {
        return publications[id] ?? null;
      },
      retrieveLocale(lang) {
        if (lang === "en-US") return localeEnUS;
        throw new Error("Unsupported locale: " + lang);
      },
    };

    const engine = new CSL.Engine(
      sys,
      styleXml.replace(/^\uFEFF/, ""),
      "en-US"
    );

    engine.updateItems(Object.keys(publications));

    const bibliography = engine.makeBibliography();

    res.json({
      entries: bibliography[1],
    });
  } catch (err) {
    console.error("Error in /render-bibliography:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (_, res) => {
  console.log("Health check requested");
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Citeproc service running on ${PORT}`));
