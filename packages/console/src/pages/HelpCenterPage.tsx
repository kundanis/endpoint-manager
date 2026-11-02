import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SearchX } from "lucide-react";
import { useMe, useModuleVisibility } from "../api/hooks";
import { HELP_MODULES, HELP_TOPICS, searchHelp, topicById } from "../help";
import { TopicView } from "../help/HelpProvider";
import { NAV_MODULES } from "../navConfig";
import { Card, EmptyState, PageHeader } from "../components/ui";

// Help Center (Pattern E): the modules and their pages on the left, the chosen page's help on
// the right, and a search across everything. Modules hidden for everyone (Licensing → Module
// visibility) are left out.
export default function HelpCenterPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const { data: visibility } = useModuleVisibility();
  const { data: me } = useMe();

  const visibleTopics = useMemo(() => {
    const allowed = HELP_TOPICS.filter((t) => !t.superAdminOnly || me?.role === "SUPER_ADMIN");
    if (!visibility) return allowed;
    return allowed.filter((t) => {
      const mod = NAV_MODULES.find((m) => m.label === t.module);
      if (mod?.licenseModule && visibility.hiddenModuleKeys.includes(mod.licenseModule)) return false;
      return !visibility.hiddenItemPaths.some((p) => t.path === p || t.path.startsWith(`${p}/`));
    });
  }, [visibility, me]);

  const requested = topicById(params.get("topic") ?? undefined);
  const selected = requested && visibleTopics.includes(requested) ? requested : visibleTopics[0];
  const results = useMemo(() => searchHelp(query).filter((r) => visibleTopics.includes(r.topic)), [query, visibleTopics]);

  return (
    <>
      <PageHeader title="Help" description="How every part of Endpoint IQ works, with step-by-step guides. Select Show me on a guide to have it point at each button for you." />
      <div className="app-help-layout">
        <Card flush>
          <nav className="app-help-nav" aria-label="Help topics">
            {HELP_MODULES.map((mod) => {
              const topics = visibleTopics.filter((t) => t.module === mod);
              if (topics.length === 0) return null;
              return (
                <div key={mod}>
                  <div className="ep-ov">{mod}</div>
                  <div className="ep-sub">
                    {topics.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={!query && t.id === selected?.id ? "ep-on-sub" : ""}
                        aria-current={!query && t.id === selected?.id ? "page" : undefined}
                        onClick={() => {
                          setQuery("");
                          setParams({ topic: t.id });
                        }}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
        </Card>
        <div className="app-stack">
          <div className="ep-input-icon">
            <Search size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
            <input
              type="search"
              className="ep-input"
              placeholder="Search help, e.g. block USB, install agent, schedule patches…"
              aria-label="Search help"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query.trim() ? (
            results.length === 0 ? (
              <Card>
                <EmptyState icon={SearchX} title="Nothing matches">
                  Try other words, or pick a page on the left.
                </EmptyState>
              </Card>
            ) : (
              results.map((r) => (
                <Card key={r.topic.id}>
                  <TopicView topic={r.topic} highlightHowTos={r.howTos} />
                </Card>
              ))
            )
          ) : selected ? (
            <Card>
              <TopicView topic={selected} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
