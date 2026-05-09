import { useState, useEffect, useMemo, type SyntheticEvent } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type AgentProviderUpdate, type OrgNode } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "../components/StatusBadge";
import { agentStatusDot, agentStatusDotDefault } from "../lib/status-colors";
import { EntityRow } from "../components/EntityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { relativeTime, cn, agentRouteRef, agentUrl } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Bot,
  ChevronDown,
  Cpu,
  GitBranch,
  List,
  Loader2,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

import { getAdapterLabel } from "../adapters/adapter-display-registry";
import { listAdapterOptions } from "../adapters/metadata";
import { useDisabledAdaptersSync } from "../adapters/use-disabled-adapters";

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;
const DEFAULT_MODEL_VALUE = "__adapter_default__";
const AUTO_EFFORT_VALUE = "__auto__";
const EFFORT_CONFIG_KEYS = [
  "modelReasoningEffort",
  "reasoningEffort",
  "effort",
  "mode",
  "variant",
] as const;

type AgentProviderDraft = {
  adapterType: string;
  model: string;
  effort: string;
};

type EffortOption = {
  id: string;
  label: string;
};

const codexEffortOptions: EffortOption[] = [
  { id: "", label: "Auto" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X-High" },
];

const cursorModeOptions: EffortOption[] = [
  { id: "", label: "Auto" },
  { id: "plan", label: "Plan" },
  { id: "ask", label: "Ask" },
];

const openCodeVariantOptions: EffortOption[] = [
  { id: "", label: "Auto" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X-High" },
  { id: "max", label: "Max" },
];

const claudeEffortOptions: EffortOption[] = [
  { id: "", label: "Auto" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

type FilterTab = "all" | "active" | "paused" | "error";

function matchesFilter(status: string, tab: FilterTab, showTerminated: boolean): boolean {
  if (status === "terminated") return showTerminated;
  if (tab === "all") return true;
  if (tab === "active") return status === "active" || status === "running" || status === "idle";
  if (tab === "paused") return status === "paused";
  if (tab === "error") return status === "error";
  return true;
}

function filterAgents(agents: Agent[], tab: FilterTab, showTerminated: boolean): Agent[] {
  return agents
    .filter((a) => matchesFilter(a.status, tab, showTerminated))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getConfiguredModel(agent: Agent): string | null {
  const value = agent.adapterConfig?.model;
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model.length > 0 ? model : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEffortKeyForAdapter(adapterType: string): string | null {
  if (adapterType === "codex_local") return "modelReasoningEffort";
  if (adapterType === "cursor") return "mode";
  if (adapterType === "opencode_local") return "variant";
  if (adapterType === "gemini_local") return null;
  return "effort";
}

function getEffortLabelForAdapter(adapterType: string): string {
  if (adapterType === "cursor") return "Mode";
  if (adapterType === "opencode_local") return "Variant";
  return "Effort";
}

function getEffortOptionsForAdapter(adapterType: string): EffortOption[] {
  if (adapterType === "codex_local") return codexEffortOptions;
  if (adapterType === "cursor") return cursorModeOptions;
  if (adapterType === "opencode_local") return openCodeVariantOptions;
  if (adapterType === "gemini_local") return [];
  return claudeEffortOptions;
}

function getConfiguredEffort(agent: Agent): string | null {
  const config = agent.adapterConfig ?? {};
  if (agent.adapterType === "codex_local") {
    return asNonEmptyString(config.modelReasoningEffort) ?? asNonEmptyString(config.reasoningEffort);
  }
  const key = getEffortKeyForAdapter(agent.adapterType);
  return key ? asNonEmptyString(config[key]) : null;
}

export function getAgentProviderDraft(agent: Agent): AgentProviderDraft {
  return {
    adapterType: agent.adapterType,
    model: getConfiguredModel(agent) ?? "",
    effort: getConfiguredEffort(agent) ?? "",
  };
}

export function buildAgentProviderSwitchPayload(
  agent: Agent,
  draft: AgentProviderDraft,
): AgentProviderUpdate {
  const adapterType = draft.adapterType.trim() || agent.adapterType;
  const adapterConfig: Record<string, unknown> =
    adapterType === agent.adapterType ? { ...(agent.adapterConfig ?? {}) } : {};
  const model = draft.model.trim();
  if (model) adapterConfig.model = model;
  else delete adapterConfig.model;

  for (const key of EFFORT_CONFIG_KEYS) delete adapterConfig[key];
  const effortKey = getEffortKeyForAdapter(adapterType);
  const effort = draft.effort.trim();
  if (effortKey && effort) adapterConfig[effortKey] = effort;

  return {
    adapterType,
    adapterConfig,
    replaceAdapterConfig: true,
  };
}

function agentProviderDraftChanged(agent: Agent, draft: AgentProviderDraft): boolean {
  const current = getAgentProviderDraft(agent);
  return (
    draft.adapterType !== current.adapterType ||
    draft.model !== current.model ||
    draft.effort !== current.effort
  );
}

function filterOrgTree(nodes: OrgNode[], tab: FilterTab, showTerminated: boolean): OrgNode[] {
  return nodes
    .reduce<OrgNode[]>((acc, node) => {
      const filteredReports = filterOrgTree(node.reports, tab, showTerminated);
      if (matchesFilter(node.status, tab, showTerminated) || filteredReports.length > 0) {
        acc.push({ ...node, reports: filteredReports });
      }
      return acc;
    }, [])
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function Agents() {
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();
  const pathSegment = location.pathname.split("/").pop() ?? "all";
  const tab: FilterTab = (pathSegment === "all" || pathSegment === "active" || pathSegment === "paused" || pathSegment === "error") ? pathSegment : "all";
  const [view, setView] = useState<"list" | "org">("org");
  const forceListView = isMobile;
  const effectiveView: "list" | "org" = forceListView ? "list" : view;
  const [showTerminated, setShowTerminated] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const disabledAdapterTypes = useDisabledAdaptersSync();

  const { data: agents, isLoading, error } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: orgTree } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId && effectiveView === "org",
  });

  const { data: runs } = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "agents-page"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  // Map agentId -> first live run + live run count
  const liveRunByAgent = useMemo(() => {
    const map = new Map<string, { runId: string; liveCount: number }>();
    for (const r of runs ?? []) {
      if (r.status !== "running" && r.status !== "queued") continue;
      const existing = map.get(r.agentId);
      if (existing) {
        existing.liveCount += 1;
        continue;
      }
      map.set(r.agentId, { runId: r.id, liveCount: 1 });
    }
    return map;
  }, [runs]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Agents" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="Select a company to view agents." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const filtered = filterAgents(agents ?? [], tab, showTerminated);
  const filteredOrg = filterOrgTree(orgTree ?? [], tab, showTerminated);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => navigate(`/agents/${v}`)}>
          <PageTabBar
            items={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "error", label: "Error" },
            ]}
            value={tab}
            onValueChange={(v) => navigate(`/agents/${v}`)}
          />
        </Tabs>
        <div className="flex items-center gap-2">
          {/* Filters */}
          <div className="relative">
            <button
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs transition-colors border border-border",
                filtersOpen || showTerminated ? "text-foreground bg-accent" : "text-muted-foreground hover:bg-accent/50"
              )}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal className="h-3 w-3" />
              Filters
              {showTerminated && <span className="ml-0.5 px-1 bg-foreground/10 rounded text-[10px]">1</span>}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-48 border border-border bg-popover shadow-md p-1">
                <button
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left hover:bg-accent/50 transition-colors"
                  onClick={() => setShowTerminated(!showTerminated)}
                >
                  <span className={cn(
                    "flex items-center justify-center h-3.5 w-3.5 border border-border rounded-sm",
                    showTerminated && "bg-foreground"
                  )}>
                    {showTerminated && <span className="text-background text-[10px] leading-none">&#10003;</span>}
                  </span>
                  Show terminated
                </button>
              </div>
            )}
          </div>
          {/* View toggle */}
          {!forceListView && (
            <div className="flex items-center border border-border">
              <button
                className={cn(
                  "p-1.5 transition-colors",
                  effectiveView === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                )}
                onClick={() => setView("list")}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                className={cn(
                  "p-1.5 transition-colors",
                  effectiveView === "org" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                )}
                onClick={() => setView("org")}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={openNewAgent}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Agent
          </Button>
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">{filtered.length} agent{filtered.length !== 1 ? "s" : ""}</p>
      )}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {agents && agents.length === 0 && (
        <EmptyState
          icon={Bot}
          message="Create your first agent to get started."
          action="New Agent"
          onAction={openNewAgent}
        />
      )}

      {/* List view */}
      {effectiveView === "list" && filtered.length > 0 && (
        <div className="border border-border">
          {filtered.map((agent) => {
            return (
              <EntityRow
                key={agent.id}
                title={agent.name}
                subtitle={`${roleLabels[agent.role] ?? agent.role}${agent.title ? ` - ${agent.title}` : ""}`}
                to={agentUrl(agent)}
                className={agent.pausedAt && tab !== "paused" ? "opacity-50" : ""}
                leading={
                  <span className="relative flex h-2.5 w-2.5">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full ${agentStatusDot[agent.status] ?? agentStatusDotDefault}`}
                    />
                  </span>
                }
                trailing={
                  <div className="flex items-center gap-3">
                    <div className="sm:hidden flex items-center gap-2">
                      <AgentProviderControl
                        agent={agent}
                        companyId={selectedCompanyId}
                        disabledAdapterTypes={disabledAdapterTypes}
                        compact
                      />
                      {liveRunByAgent.has(agent.id) ? (
                        <LiveRunIndicator
                          agentRef={agentRouteRef(agent)}
                          runId={liveRunByAgent.get(agent.id)!.runId}
                          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
                        />
                      ) : (
                        <StatusBadge status={agent.status} />
                      )}
                    </div>
                    <div className="hidden sm:flex items-center gap-3">
                      {liveRunByAgent.has(agent.id) && (
                        <LiveRunIndicator
                          agentRef={agentRouteRef(agent)}
                          runId={liveRunByAgent.get(agent.id)!.runId}
                          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
                        />
                      )}
                      <AgentProviderControl
                        agent={agent}
                        companyId={selectedCompanyId}
                        disabledAdapterTypes={disabledAdapterTypes}
                      />
                      <span className="text-xs text-muted-foreground w-16 text-right">
                        {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
                      </span>
                      <span className="w-20 flex justify-end">
                        <StatusBadge status={agent.status} />
                      </span>
                    </div>
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      {effectiveView === "list" && agents && agents.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match the selected filter.
        </p>
      )}

      {/* Org chart view */}
      {effectiveView === "org" && filteredOrg.length > 0 && (
        <div className="border border-border py-1">
          {filteredOrg.map((node) => (
            <OrgTreeNode
              key={node.id}
              node={node}
              depth={0}
              agentMap={agentMap}
              liveRunByAgent={liveRunByAgent}
              tab={tab}
              companyId={selectedCompanyId}
              disabledAdapterTypes={disabledAdapterTypes}
            />
          ))}
        </div>
      )}

      {effectiveView === "org" && orgTree && orgTree.length > 0 && filteredOrg.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match the selected filter.
        </p>
      )}

      {effectiveView === "org" && orgTree && orgTree.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No organizational hierarchy defined.
        </p>
      )}
    </div>
  );
}

function OrgTreeNode({
  node,
  depth,
  agentMap,
  liveRunByAgent,
  tab,
  companyId,
  disabledAdapterTypes,
}: {
  node: OrgNode;
  depth: number;
  agentMap: Map<string, Agent>;
  liveRunByAgent: Map<string, { runId: string; liveCount: number }>;
  tab: FilterTab;
  companyId: string;
  disabledAdapterTypes: Set<string>;
}) {
  const agent = agentMap.get(node.id);

  const statusColor = agentStatusDot[node.status] ?? agentStatusDotDefault;

  return (
    <div style={{ paddingLeft: depth * 24 }}>
      <Link
        to={agent ? agentUrl(agent) : `/agents/${node.id}`}
        className={cn("flex items-center gap-3 px-3 py-2 hover:bg-accent/30 transition-colors w-full text-left no-underline text-inherit", agent?.pausedAt && tab !== "paused" && "opacity-50")}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className={`absolute inline-flex h-full w-full rounded-full ${statusColor}`} />
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{node.name}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {roleLabels[node.role] ?? node.role}
            {agent?.title ? ` - ${agent.title}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="sm:hidden flex items-center gap-2">
            {agent && (
              <AgentProviderControl
                agent={agent}
                companyId={companyId}
                disabledAdapterTypes={disabledAdapterTypes}
                compact
              />
            )}
            {liveRunByAgent.has(node.id) ? (
              <LiveRunIndicator
                agentRef={agent ? agentRouteRef(agent) : node.id}
                runId={liveRunByAgent.get(node.id)!.runId}
                liveCount={liveRunByAgent.get(node.id)!.liveCount}
              />
            ) : (
              <StatusBadge status={node.status} />
            )}
          </div>
          <div className="hidden sm:flex items-center gap-3">
            {liveRunByAgent.has(node.id) && (
              <LiveRunIndicator
                agentRef={agent ? agentRouteRef(agent) : node.id}
                runId={liveRunByAgent.get(node.id)!.runId}
                liveCount={liveRunByAgent.get(node.id)!.liveCount}
              />
            )}
            {agent && (
              <>
                <AgentProviderControl
                  agent={agent}
                  companyId={companyId}
                  disabledAdapterTypes={disabledAdapterTypes}
                />
                <span className="text-xs text-muted-foreground w-16 text-right">
                  {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
                </span>
              </>
            )}
            <span className="w-20 flex justify-end">
              <StatusBadge status={node.status} />
            </span>
          </div>
        </div>
      </Link>
      {node.reports && node.reports.length > 0 && (
        <div className="border-l border-border/50 ml-4">
          {node.reports.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              agentMap={agentMap}
              liveRunByAgent={liveRunByAgent}
              tab={tab}
              companyId={companyId}
              disabledAdapterTypes={disabledAdapterTypes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentProviderControl({
  agent,
  companyId,
  disabledAdapterTypes,
  compact = false,
}: {
  agent: Agent;
  companyId: string;
  disabledAdapterTypes: Set<string>;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AgentProviderDraft>(() => getAgentProviderDraft(agent));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const adapterOptions = useMemo(() => {
    const options = listAdapterOptions()
      .filter((option) => !option.comingSoon && !option.hidden && !disabledAdapterTypes.has(option.value));
    if (!options.some((option) => option.value === agent.adapterType)) {
      options.push({
        value: agent.adapterType,
        label: getAdapterLabel(agent.adapterType),
        comingSoon: false,
        hidden: false,
        experimental: false,
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [agent.adapterType, disabledAdapterTypes]);
  const modelQuery = useQuery({
    queryKey: queryKeys.agents.adapterModels(companyId, draft.adapterType, agent.defaultEnvironmentId ?? null),
    queryFn: () => agentsApi.adapterModels(companyId, draft.adapterType, {
      environmentId: agent.defaultEnvironmentId ?? null,
    }),
    enabled: open,
  });
  const modelOptions = useMemo(() => {
    const rows = modelQuery.data ?? [];
    if (!draft.model || rows.some((model) => model.id === draft.model)) return rows;
    return [{ id: draft.model, label: draft.model }, ...rows];
  }, [draft.model, modelQuery.data]);
  const effortOptions = getEffortOptionsForAdapter(draft.adapterType);
  const currentModel = getConfiguredModel(agent);
  const currentEffort = getConfiguredEffort(agent);
  const triggerTitle = [
    getAdapterLabel(agent.adapterType),
    currentModel,
    currentEffort,
  ].filter(Boolean).join(" / ");
  const changed = agentProviderDraftChanged(agent, draft);

  const updateProvider = useMutation({
    mutationFn: () => agentsApi.updateProvider(agent.id, buildAgentProviderSwitchPayload(agent, draft), companyId),
    onMutate: () => setErrorMessage(null),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.agents.detail(agent.id), updated);
      queryClient.setQueryData(queryKeys.agents.detail(agent.urlKey), updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.configRevisions(agent.id) });
      setDraft(getAgentProviderDraft(updated));
      setOpen(false);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Provider update failed");
    },
  });

  useEffect(() => {
    if (!open) setDraft(getAgentProviderDraft(agent));
  }, [agent, open]);

  function stopRowNavigation(event: SyntheticEvent) {
    event.stopPropagation();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setDraft(getAgentProviderDraft(agent));
          setErrorMessage(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
            compact ? "w-8 justify-center px-0" : "w-56 justify-between",
          )}
          title={triggerTitle || "Runtime"}
          aria-label={`Runtime for ${agent.name}`}
          onPointerDown={stopRowNavigation}
          onClick={stopRowNavigation}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            {!compact && (
              <span className="min-w-0 truncate font-mono">
                {getAdapterLabel(agent.adapterType)}
                {currentModel ? ` / ${currentModel}` : ""}
              </span>
            )}
          </span>
          {!compact && <ChevronDown className="h-3 w-3 shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-3"
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!changed || updateProvider.isPending) return;
            updateProvider.mutate();
          }}
        >
          <label className="block space-y-1">
            <span className="text-[11px] uppercase text-muted-foreground">Adapter</span>
            <select
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
              value={draft.adapterType}
              disabled={updateProvider.isPending}
              onChange={(event) => {
                setDraft((prev) => ({
                  ...prev,
                  adapterType: event.target.value,
                  model: "",
                  effort: "",
                }));
              }}
            >
              {adapterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] uppercase text-muted-foreground">Model</span>
            <select
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
              value={draft.model || DEFAULT_MODEL_VALUE}
              disabled={updateProvider.isPending}
              onChange={(event) => {
                setDraft((prev) => ({
                  ...prev,
                  model: event.target.value === DEFAULT_MODEL_VALUE ? "" : event.target.value,
                }));
              }}
            >
              {draft.adapterType !== "opencode_local" && (
                <option value={DEFAULT_MODEL_VALUE}>Adapter default</option>
              )}
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            {modelQuery.isLoading && (
              <span className="text-xs text-muted-foreground">Loading models...</span>
            )}
            {modelQuery.error instanceof Error && (
              <span className="text-xs text-destructive">{modelQuery.error.message}</span>
            )}
          </label>

          {effortOptions.length > 0 && (
            <label className="block space-y-1">
              <span className="text-[11px] uppercase text-muted-foreground">
                {getEffortLabelForAdapter(draft.adapterType)}
              </span>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
                value={draft.effort || AUTO_EFFORT_VALUE}
                disabled={updateProvider.isPending}
                onChange={(event) => {
                  setDraft((prev) => ({
                    ...prev,
                    effort: event.target.value === AUTO_EFFORT_VALUE ? "" : event.target.value,
                  }));
                }}
              >
                {effortOptions.map((option) => (
                  <option key={option.id || AUTO_EFFORT_VALUE} value={option.id || AUTO_EFFORT_VALUE}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {errorMessage && (
            <p className="text-xs text-destructive" role="alert">{errorMessage}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={updateProvider.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!changed || updateProvider.isPending}
            >
              {updateProvider.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function LiveRunIndicator({
  agentRef,
  runId,
  liveCount,
}: {
  agentRef: string;
  runId: string;
  liveCount: number;
}) {
  return (
    <Link
      to={`/agents/${agentRef}/runs/${runId}`}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
        Live{liveCount > 1 ? ` (${liveCount})` : ""}
      </span>
    </Link>
  );
}
