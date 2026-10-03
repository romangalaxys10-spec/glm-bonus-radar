import type { Metadata } from "next";
import { SearchClient } from "./search-client";

export const metadata: Metadata = {
  title: "zSearch — the GEO-first search engine · GLM Bonus Radar",
  description:
    "Search the live web the way generative engines read it. Instead of SEO, every result is scored for GEO — Generative Engine Optimization: citability, structure, freshness and entity clarity — and an AI answer preview shows which sources actually get cited. Free, no signup.",
  alternates: { canonical: "/search" },
  openGraph: {
    title: "zSearch — the GEO-first search engine",
    description:
      "Google ranks blue links by SEO. zSearch ranks sources by how citable they are inside AI answers — every result carries a GEO rating, and an AI answer preview shows who actually gets cited.",
    type: "website",
  },
};

export default function SearchPage() {
  return <SearchClient />;
}
