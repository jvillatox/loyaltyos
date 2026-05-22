import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className="hero hero--primary">
      <div className="container" style={{ padding: "4rem 0" }}>
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div
          style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "1.5rem" }}
        >
          <Link className="button button--secondary button--lg" to="/docs/getting-started/intro">
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="https://github.com/jvillatox/loyaltyos"
          >
            GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  return (
    <Layout
      title="Home"
      description="Open source customer loyalty platform with native coalition support"
    >
      <HomepageHeader />
      <main style={{ padding: "3rem 0" }}>
        <div className="container">
          <div className="row">
            <div className="col col--4">
              <Heading as="h3">Dual Points Programs</Heading>
              <p>
                Run your own proprietary points alongside external coalition points like Puntos
                Apprecio. One platform, both worlds.
              </p>
            </div>
            <div className="col col--4">
              <Heading as="h3">API-First Design</Heading>
              <p>
                Everything the Admin UI can do is available via REST. Fastify + Zod + Swagger —
                type-safe from end to end.
              </p>
            </div>
            <div className="col col--4">
              <Heading as="h3">Modular & Extensible</Heading>
              <p>
                Plug in campaigns, coupons, badges, tiers, and coalition adapters as needed. Nothing
                is hardcoded.
              </p>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
