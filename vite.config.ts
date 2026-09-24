import { defineConfig } from "vite";

function basePath(): string {
  const raw = process.env.BASE_PATH || "/";
  if (raw === "/" || raw === "") return "/";
  const withSlash = raw.endsWith("/") ? raw : `${raw}/`;
  return withSlash.startsWith("/") ? withSlash : `/${withSlash}`;
}

export default defineConfig({
  base: basePath(),
  define: {
    __SITE_BUILD__: JSON.stringify(new Date().toISOString()),
  },
});
