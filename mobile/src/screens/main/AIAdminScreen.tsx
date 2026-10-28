import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { apiRequest } from '../../api/client';
import { showAlert } from '../../components/dialogs';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { Button, Card, ScreenHeader, SectionHeader } from '../../ui/kit';

type Agent = { feature_key: string; name: string; description: string; enabled: boolean; provider: string; model: string; prompt_version: string; timeout_seconds: number; max_output_tokens: number; run_count: number; error_count: number; average_latency_ms: number };
type Prompt = { id: number; version: number; status: string; system_prompt: string };
type Model = { id: number; provider: string; model: string; enabled: boolean };

export function AIAdminScreen({ onBack }: { onBack: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [draft, setDraft] = useState('');
  const [sample, setSample] = useState('Help me break my study plan into small steps.');
  const [modelName, setModelName] = useState('gpt-4.1-mini');
  const [inputRate, setInputRate] = useState('');
  const [outputRate, setOutputRate] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [overview, recentRuns, scored, changes] = await Promise.all([
        apiRequest<{ agents: Agent[]; models: Model[]; provider_configured: boolean; ai_service_available: boolean }>('/api/admin/ai/overview', { auth: true }),
        apiRequest<any[]>('/api/admin/ai/runs?limit=20', { auth: true }),
        apiRequest<any[]>('/api/admin/ai/evaluations', { auth: true }),
        apiRequest<any[]>('/api/admin/ai/audit?limit=20', { auth: true }),
      ]);
      setAgents(overview.agents); setModels(overview.models); setProviderConfigured(overview.provider_configured); setServiceAvailable(overview.ai_service_available); setRuns(recentRuns); setEvaluations(scored); setAudit(changes);
    } catch (error) { showAlert('Could not load AI Admin', (error as Error).message); }
  }, []);

  const loadPrompts = useCallback(async (feature: string) => {
    setSelected(feature);
    try {
      const rows = await apiRequest<Prompt[]>(`/api/admin/ai/agents/${feature}/prompts`, { auth: true });
      setPrompts(rows);
      setDraft(rows.find((prompt) => prompt.status === 'draft')?.system_prompt ?? rows[0]?.system_prompt ?? '');
    } catch (error) { showAlert('Could not load prompts', (error as Error).message); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleAgent = async (agent: Agent) => {
    try {
      await apiRequest(`/api/admin/ai/agents/${agent.feature_key}`, { method: 'PATCH', body: { enabled: !agent.enabled }, auth: true });
      await refresh();
    } catch (error) { showAlert('Could not update agent', (error as Error).message); }
  };
  const saveModel = async (agent: Agent, model: string) => {
    try {
      await apiRequest(`/api/admin/ai/features/${agent.feature_key}/config`, {
        method: 'PUT', body: { provider: 'openai', model, parameters: {}, max_output_tokens: agent.max_output_tokens, timeout_seconds: agent.timeout_seconds }, auth: true,
      });
      await refresh();
    } catch (error) { showAlert('Could not update model', (error as Error).message); }
  };
  const registerModel = async () => {
    try {
      await apiRequest('/api/admin/ai/models', { method: 'POST', body: {
        provider: 'openai', model: modelName.trim(),
        input_cost_microusd_per_1k: inputRate ? Number(inputRate) : null,
        output_cost_microusd_per_1k: outputRate ? Number(outputRate) : null,
      }, auth: true });
      setInputRate(''); setOutputRate(''); await refresh();
    } catch (error) { showAlert('Could not register model', (error as Error).message); }
  };
  const evaluateRun = async (runId: number, score: number) => {
    try { await apiRequest(`/api/admin/ai/runs/${runId}/evaluation`, { method: 'POST', body: { score }, auth: true }); await refresh(); }
    catch (error) { showAlert('Could not save evaluation', (error as Error).message); }
  };
  const saveDraft = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/ai/agents/${selected}/prompts`, { method: 'POST', body: { system_prompt: draft }, auth: true });
      await loadPrompts(selected); showAlert('Draft saved', 'A new draft version was created.');
    } catch (error) { showAlert('Could not save prompt', (error as Error).message); }
    finally { setBusy(false); }
  };
  const testDraft = async () => {
    const candidate = prompts.find((prompt) => prompt.status === 'draft');
    if (!candidate) { showAlert('Save a draft first', 'Save the prompt before testing it.'); return; }
    setBusy(true);
    try {
      const result = await apiRequest<{ reply: string }>(`/api/admin/ai/prompts/${candidate.id}/test`, { method: 'POST', body: { user_input: sample }, auth: true });
      showAlert('Test result', result.reply); await refresh();
    } catch (error) { showAlert('Prompt test failed', (error as Error).message); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    const candidate = prompts.find((prompt) => prompt.status === 'draft');
    if (!candidate) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/ai/prompts/${candidate.id}/publish`, { method: 'POST', auth: true });
      await loadPrompts(selected!); await refresh();
      showAlert('Prompt published', `Version ${candidate.version} is active. Archived versions can be published again to roll back.`);
    } catch (error) { showAlert('Could not publish prompt', (error as Error).message); }
    finally { setBusy(false); }
  };
  const restoreVersion = async (prompt: Prompt) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admin/ai/prompts/${prompt.id}/publish`, { method: 'POST', auth: true });
      await loadPrompts(selected!); await refresh();
      showAlert('Version restored', `Prompt v${prompt.version} is active again.`);
    } catch (error) { showAlert('Could not restore version', (error as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <ScreenHeader title="AI Admin" subtitle="Agents, prompts, models and quality"
      right={<Pressable onPress={selected ? () => setSelected(null) : onBack} hitSlop={10}><Text style={styles.link}>{selected ? 'Agents' : 'Close'}</Text></Pressable>} />
    {!selected ? <>
      <SectionHeader title="AI Agents" />
      {!providerConfigured && <Card style={styles.card}><Text style={styles.error}>No provider API key is configured in the AI Engine environment. AI runs will be unavailable.</Text></Card>}
      {!serviceAvailable && <Card style={styles.card}><Text style={styles.error}>AI Engine is offline or its backend service token is not configured.</Text></Card>}
      <Card style={styles.card}><Text style={styles.title}>Register an OpenAI model</Text>
        <TextInput value={modelName} onChangeText={setModelName} style={styles.input} placeholder="Model ID" />
        <View style={styles.row}><TextInput value={inputRate} onChangeText={setInputRate} style={[styles.input, styles.rateInput]} keyboardType="numeric" placeholder="Input µUSD / 1k" />
          <TextInput value={outputRate} onChangeText={setOutputRate} style={[styles.input, styles.rateInput]} keyboardType="numeric" placeholder="Output µUSD / 1k" /></View>
        <Button title="Register model" onPress={() => void registerModel()} disabled={!modelName.trim()} />
      </Card>
      {agents.map((agent) => <Card key={agent.feature_key} style={styles.card}>
        <View style={styles.row}><View style={styles.grow}><Text style={styles.title}>{agent.name}</Text><Text style={styles.muted}>{agent.description}</Text></View>
          <Pressable onPress={() => void toggleAgent(agent)} style={[styles.pill, agent.enabled && styles.enabled]}><Text style={styles.pillText}>{agent.enabled ? 'On' : 'Off'}</Text></Pressable></View>
        <Text style={styles.muted}>Model: {agent.provider}/{agent.model} · Prompt v{agent.prompt_version}</Text>
        <Text style={styles.muted}>Runs {agent.run_count} · Errors {agent.error_count} · Avg {agent.average_latency_ms} ms</Text>
        <View style={styles.row}><Pressable onPress={() => void loadPrompts(agent.feature_key)}><Text style={styles.link}>Manage prompts</Text></Pressable>
          <View style={styles.modelRow}>{models.filter((model) => model.enabled).map((model) => <Pressable key={model.id} onPress={() => void saveModel(agent, model.model)}><Text style={[styles.model, agent.model === model.model && styles.link]}>{model.model}</Text></Pressable>)}</View></View>
      </Card>)}
      <SectionHeader title="Recent runs" />
      {runs.map((run) => <Card key={run.id} style={styles.card}><Text style={styles.title}>#{run.id} · {run.feature_key} · {run.status}</Text><Text style={styles.muted}>{run.provider}/{run.model} · prompt {run.prompt_version} · {run.latency_ms ?? '—'} ms · {run.prompt_tokens ?? '—'}/{run.completion_tokens ?? '—'} tokens · {run.cost_microusd == null ? 'Cost not configured' : `${run.cost_microusd} µUSD`}</Text>{run.error_code ? <Text style={styles.error}>{run.error_code}</Text> : null}<View style={styles.row}>{[1, 2, 3, 4, 5].map((score) => <Pressable key={score} onPress={() => void evaluateRun(run.id, score)}><Text style={styles.link}>{score}★</Text></Pressable>)}</View></Card>)}
      <SectionHeader title="Quality evaluations" />
      {evaluations.slice(0, 8).map((item) => <Card key={item.id} style={styles.card}><Text style={styles.title}>{item.feature_key} · {item.score}/5 · prompt v{item.prompt_version}</Text>{item.notes ? <Text style={styles.muted}>{item.notes}</Text> : null}</Card>)}
      <SectionHeader title="Configuration audit" />
      {audit.map((item) => <Card key={item.id} style={styles.card}><Text style={styles.title}>{item.action} · {item.target_type}/{item.target_id}</Text><Text style={styles.muted}>Admin #{item.actor_user_id} · {new Date(item.created_at).toLocaleString()}</Text></Card>)}
    </> : <>
      <SectionHeader title={`Prompt ${selected}`} />
      <View style={styles.versionRow}>{prompts.map((prompt) => <View key={prompt.id} style={styles.versionItem}><Pressable onPress={() => setDraft(prompt.system_prompt)} style={[styles.pill, prompt.status === 'published' && styles.enabled]}><Text style={styles.pillText}>v{prompt.version} · {prompt.status}</Text></Pressable>{prompt.status === 'archived' && <Pressable onPress={() => void restoreVersion(prompt)}><Text style={styles.link}>Restore</Text></Pressable>}</View>)}</View>
      <TextInput multiline value={draft} onChangeText={setDraft} style={styles.editor} textAlignVertical="top" placeholder="System prompt" />
      <TextInput value={sample} onChangeText={setSample} style={styles.input} placeholder="Input sample" />
      <Button title={busy ? 'Working…' : 'Save new draft'} onPress={() => void saveDraft()} disabled={busy || !draft.trim()} />
      <Button title="Test draft" variant="secondary" onPress={() => void testDraft()} disabled={busy} />
      <Button title="Publish draft" onPress={() => void publish()} disabled={busy || !prompts.some((prompt) => prompt.status === 'draft')} />
      <Text style={styles.muted}>Publishing an archived version rolls back to it. Changes are audited by the backend.</Text>
    </>}
  </>;
}

const styles = StyleSheet.create({ card: { marginBottom: 10, gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, grow: { flex: 1 },
  title: { color: t.ink, fontSize: 15, fontWeight: '800' }, muted: { color: t.muted, fontSize: 12 }, link: { color: t.accent, fontWeight: '800' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: t.tint }, enabled: { backgroundColor: t.successBg }, pillText: { color: t.ink, fontSize: 12, fontWeight: '800' },
  modelRow: { flexDirection: 'row', gap: 8 }, model: { color: t.muted, fontSize: 11 }, versionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }, versionItem: { gap: 4, alignItems: 'center' },
  editor: { minHeight: 180, backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 16, padding: 14, color: t.ink, marginBottom: 12 },
  input: { backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 12, color: t.ink, marginBottom: 12 }, rateInput: { flex: 1 }, error: { color: t.danger, fontSize: 12 },
});
