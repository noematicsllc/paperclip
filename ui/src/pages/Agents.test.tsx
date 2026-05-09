// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agents, buildAgentProviderSwitchPayload } from "./Agents";

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  org: vi.fn(),
}));

const mockHeartbeatsApi = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
}));

const mockOpenNewAgent = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/agents/all", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewAgent: mockOpenNewAgent }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: mockHeartbeatsApi,
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => type,
  getAdapterLabels: () => ({}),
  getAdapterDisplay: (type: string) => ({
    label: type,
    description: type,
    icon: () => null,
  }),
}));

vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => new Set<string>(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("Agents", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ adapterConfig: { model: "gpt-5.4" } }),
    ]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "agent-1",
        name: "Alpha",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      flushSync(() => currentRoot.unmount());
      await flushReact();
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the configured model beside the adapter on the all agents page", async () => {
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Agents />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("codex_local");
    expect(container.textContent).toContain("gpt-5.4");
  });

  it("builds a single provider switch payload while preserving same-adapter config", () => {
    const agent = makeAgent({
      adapterType: "codex_local",
      adapterConfig: {
        env: { OPENAI_API_KEY: { type: "secret", secretId: "secret-1" } },
        model: "gpt-5.4",
        timeoutSec: 900,
        reasoningEffort: "medium",
      },
    });

    expect(buildAgentProviderSwitchPayload(agent, {
      adapterType: "codex_local",
      model: "gpt-5.5",
      effort: "high",
    })).toEqual({
      adapterType: "codex_local",
      replaceAdapterConfig: true,
      adapterConfig: {
        env: { OPENAI_API_KEY: { type: "secret", secretId: "secret-1" } },
        model: "gpt-5.5",
        timeoutSec: 900,
        modelReasoningEffort: "high",
      },
    });
  });

  it("lets the provider route preserve adapter-agnostic keys on adapter changes", () => {
    const agent = makeAgent({
      adapterType: "codex_local",
      adapterConfig: {
        env: { OPENAI_API_KEY: { type: "secret", secretId: "secret-1" } },
        model: "gpt-5.4",
        timeoutSec: 900,
      },
    });

    expect(buildAgentProviderSwitchPayload(agent, {
      adapterType: "claude_local",
      model: "claude-default",
      effort: "medium",
    })).toEqual({
      adapterType: "claude_local",
      replaceAdapterConfig: true,
      adapterConfig: {
        model: "claude-default",
        effort: "medium",
      },
    });
  });
});
