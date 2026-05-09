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
  capacity: vi.fn(),
  recordCapacitySnapshot: vi.fn(),
  adapterModels: vi.fn(),
  updateProvider: vi.fn(),
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
    const capacityPayload = {
      agentId: "agent-1",
      adapterType: "codex_local",
      provider: "openai",
      model: "gpt-5.4",
      subscriptionId: "openai:default",
      cost30dCents: 1234,
      cost30dLabel: "$12.34",
      weekly: {
        label: "Weekly limit",
        kind: "weekly",
        source: "operator-manual-entry",
        sourceLabel: "vendor dashboard",
        capturedAt: "2026-05-09T22:00:00.000Z",
        staleDays: 0,
        stale: false,
        usedPercent: 60,
        remainingPercent: 40,
        limitValue: 100,
        usedValue: 60,
        remainingValue: 40,
        unit: "tokens",
        resetsAt: null,
        valueLabel: "40 remaining",
        detail: "vendor dashboard",
      },
      rolling: {
        label: "5h limit",
        kind: "rolling",
        source: "codex-rpc",
        sourceLabel: "codex-rpc",
        capturedAt: "2026-05-09T22:00:00.000Z",
        staleDays: 0,
        stale: false,
        usedPercent: 30,
        remainingPercent: 70,
        limitValue: null,
        usedValue: null,
        remainingValue: null,
        unit: null,
        resetsAt: null,
        valueLabel: null,
        detail: null,
      },
      windows: [],
      manualEntryAllowed: true,
      narrative: "openai 30d cost $12.34 · weekly 60% used · rolling 30% used",
      updatedAt: "2026-05-09T22:00:00.000Z",
    };
    mockAgentsApi.capacity.mockResolvedValue(capacityPayload);
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "gpt-5.4", label: "GPT-5.4" },
    ]);
    mockAgentsApi.updateProvider.mockImplementation((_id, payload) => Promise.resolve({
      ...makeAgent({ adapterConfig: payload.adapterConfig ?? {} }),
    }));
    mockAgentsApi.recordCapacitySnapshot.mockResolvedValue(capacityPayload);
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

  it("shows subscription capacity when the runtime dropdown opens", async () => {
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

    const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="Runtime for Alpha"]');
    expect(trigger).not.toBeNull();
    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushReact();
    await flushReact();
    await flushReact();

    expect(mockAgentsApi.capacity).toHaveBeenCalledWith("agent-1", "company-1");
    expect(document.body.textContent).toContain("Weekly limit");
    expect(document.body.textContent).toContain("60% used / 40% rem");
    expect(document.body.textContent).toContain("4-5h rolling");
    expect(document.body.textContent).toContain("30% used / 70% rem");
    expect(document.body.textContent).toContain("$12.34");
    expect(document.body.textContent).toContain("Update from dashboard");
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
