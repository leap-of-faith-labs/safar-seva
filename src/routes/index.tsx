import { createFileRoute, redirect } from "@tanstack/react-router";

// Safar Seva is a static app served from /safar/; the home page forwards there.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ href: "/safar/index.html" });
  },
  head: () => ({
    meta: [
      { title: "Safar Seva · Pune Metro" },
      { name: "description", content: "A Marathi-first Pune Metro pilot: one small act at a time along your ride." },
      { property: "og:title", content: "Safar Seva · Pune Metro" },
      { property: "og:description", content: "Learn, give and notice along your Pune Metro ride." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
