import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Box, Button, Flex, IconButton, Text, TextField, Tooltip } from '@radix-ui/themes';
import { Check, ChevronLeft, ChevronRight, Minus, Pencil, Plus, X } from 'lucide-react';
import type { StudioQuestion, StudioStop, StudioWorkspace } from '../../shared/studio';
import {
  answerText,
  clarifyQuestions,
  clarifySpec,
  answeredChildren,
  isAnswered,
  parseAges,
  planClarifyAnswers,
  type ClarifyAnswer,
  type ClarifyAnswers,
  type ClarifyPlan,
} from '../../shared/studio-clarify';
import { studioCountries } from '../../shared/studio-travel-research';

/* The brief's open questions, asked one at a time above the composer and sent together.

   Answering them in the chat cost a full review per answer — eight questions, eight model calls,
   eight waits. Here the agent works through all of them first and applies once: picks and values
   go to the brief in a single PATCH, and only what they wrote in their own words goes to Tara,
   in one turn (shared/studio-clarify.ts). Nothing is required except what the server marks as
   required; Apply is live from the first answer. */

const storageKey = (workspaceId: string) => `asktara-clarify:${workspaceId}`;
function readDraft(workspaceId: string): ClarifyAnswers {
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey(workspaceId)) || '{}');
    return stored && typeof stored === 'object' ? (stored as ClarifyAnswers) : {};
  } catch {
    return {};
  }
}
function writeDraft(workspaceId: string, answers: ClarifyAnswers) {
  try {
    if (Object.keys(answers).length)
      sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(answers));
    else sessionStorage.removeItem(storageKey(workspaceId));
  } catch {
    /* A draft that cannot be kept still works for this visit. */
  }
}

export interface ClarifyResult {
  saved: boolean;
  sent: boolean;
}

export function StudioClarifyTray({
  workspace,
  disabled,
  focusRequest,
  onApply,
  onClose,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  /** Bumped by "Answer now" on the brief card, to bring the agent's focus here. */
  focusRequest: number;
  /** Saves the plan; reports which half landed so only that half leaves the draft. */
  onApply: (plan: ClarifyPlan) => Promise<ClarifyResult>;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<ClarifyAnswers>(() => readDraft(workspace.id));
  const [index, setIndex] = useState(0);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const questions = useMemo(
    () => clarifyQuestions(workspace.qualification.questions, answers, workspace.brief),
    [workspace.qualification.questions, workspace.brief, answers],
  );
  useEffect(() => writeDraft(workspace.id, answers), [workspace.id, answers]);
  useEffect(() => {
    if (focusRequest) root.current?.focus();
  }, [focusRequest]);
  /* A question the server has stopped asking — answered in chat, or in the brief dialog — takes
     its draft answer with it, so Apply never re-sends something already settled. */
  useEffect(() => {
    const open = new Set(questions.map((question) => question.id));
    setAnswers((current) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([id]) => open.has(id)));
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    });
  }, [questions]);
  useEffect(() => {
    if (index >= questions.length) setIndex(Math.max(0, questions.length - 1));
  }, [index, questions.length]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const plan = planClarifyAnswers(
    workspace.qualification.questions,
    answers,
    workspace.brief,
    workspace.stops,
  );
  const answered = plan.saved.length + plan.forTara.length;
  const skipped = questions.filter((question) => answers[question.id]?.kind === 'skip').length;
  const question = questions[index] as StudioQuestion | undefined;

  if (!question)
    return notice ? (
      <Text as="p" size="2" color="green" role="status">
        <Flex as="span" align="center" gap="2">
          <Check size={14} aria-hidden="true" /> {notice}
        </Flex>
      </Text>
    ) : null;

  const spec = clarifySpec(question.id);
  const answer = answers[question.id];
  const set = (value: ClarifyAnswer | undefined) =>
    setAnswers((current) => {
      const next = { ...current };
      if (value) next[question.id] = value;
      else delete next[question.id];
      return next;
    });
  /* The next question still waiting for an answer, wrapping once; staying put when every question
     has one, so the last pick does not throw the agent back to the start. */
  const advance = (after: ClarifyAnswers) => {
    /* Against the list the new answer produces: a children count inserts the ages question right
       after it, and that is where the agent should land. */
    const list = clarifyQuestions(workspace.qualification.questions, after, workspace.brief);
    const from = Math.max(
      0,
      list.findIndex((item) => item.id === question.id),
    );
    for (let step = 1; step < list.length; step++) {
      const next = (from + step) % list.length;
      if (!after[list[next].id]) return setIndex(next);
    }
  };
  const pick = (optionId: string) => {
    const value: ClarifyAnswer = { kind: 'option', optionId };
    set(value);
    advance({ ...answers, [question.id]: value });
  };
  const skip = () => {
    const value: ClarifyAnswer = { kind: 'skip' };
    set(value);
    advance({ ...answers, [question.id]: value });
  };
  const apply = async () => {
    if (!answered || applying || disabled) return;
    setApplying(true);
    try {
      const result = await onApply(plan);
      const landed = new Set(
        [...(result.saved ? plan.saved : []), ...(result.sent ? plan.forTara : [])].map(
          (line) => line.questionId,
        ),
      );
      setAnswers((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !landed.has(id))),
      );
      setIndex(0);
      if (result.saved || result.sent) {
        const parts = [];
        if (result.saved && plan.saved.length)
          parts.push(`${plan.saved.length} saved to the brief`);
        if (result.sent && plan.forTara.length) parts.push(`${plan.forTara.length} sent to Tara`);
        setNotice(`Answers applied · ${parts.join(' · ')}`);
      }
    } finally {
      setApplying(false);
    }
  };
  /* Agents work through these all day, so the keyboard gets the same reach as the pointer: a
     digit picks that option, the arrows step between questions, Escape puts the tray away. Typing
     in a field keeps its keys. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const typing = (event.target as HTMLElement).closest('input, textarea');
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= spec.options.length) {
      event.preventDefault();
      pick(spec.options[digit - 1].id);
    } else if (event.key === 'ArrowRight' && index < questions.length - 1) {
      event.preventDefault();
      setIndex(index + 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      setIndex(index - 1);
    }
  };
  const textValue = answer?.kind === 'text' ? answer.text : '';
  const inputValue = answer?.kind === 'value' ? answer.value : '';

  return (
    <Box
      ref={root}
      role="region"
      aria-label="Questions from Tara"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        background: 'var(--color-panel-solid)',
        border: '1px solid var(--gray-a5)',
        borderRadius: 'var(--radius-4)',
        boxShadow: 'var(--shadow-2)',
        /* The composer below must stay on screen on a phone; the tray scrolls inside itself. */
        maxHeight: '45dvh',
        overflowY: 'auto',
        outline: 'none',
      }}
    >
      <Box p="3" pb="2">
        <Flex align="start" justify="between" gap="3">
          <Box minWidth="0">
            <Text as="p" size="2" weight="medium" id="clarify-question">
              {question.label}
            </Text>
            <Text as="p" size="1" color="gray" mt="1">
              {question.required && (
                <Text color="amber" weight="medium">
                  Required ·{' '}
                </Text>
              )}
              {question.reason}
            </Text>
          </Box>
          <Flex align="center" gap="1" flexShrink="0">
            <Text size="1" color="gray" aria-live="polite" style={{ whiteSpace: 'nowrap' }}>
              {index + 1} of {questions.length}
            </Text>
            <IconButton
              size="2"
              variant="ghost"
              color="gray"
              aria-label="Previous question"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton
              size="2"
              variant="ghost"
              color="gray"
              aria-label="Next question"
              disabled={index >= questions.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <ChevronRight size={16} />
            </IconButton>
            <Tooltip content="Close (Esc). Your answers are kept.">
              <IconButton
                size="2"
                variant="ghost"
                color="gray"
                aria-label="Close questions"
                onClick={onClose}
              >
                <X size={16} />
              </IconButton>
            </Tooltip>
          </Flex>
        </Flex>
        {/* Where the agent is and what is done, at a glance. Not buttons: eight 44px targets do
            not fit the chat column, and the arrows already move between questions. */}
        <Flex gap="1" mt="2" aria-hidden="true">
          {questions.map((item, at) => {
            const state = answers[item.id];
            const done = isAnswered(state);
            return (
              <Box
                key={item.id}
                style={{
                  height: 4,
                  flex: 1,
                  borderRadius: 2,
                  background: done
                    ? 'var(--accent-9)'
                    : state?.kind === 'skip'
                      ? 'var(--gray-a6)'
                      : 'var(--gray-a4)',
                  outline: at === index ? '1px solid var(--accent-8)' : undefined,
                  outlineOffset: 1,
                }}
              />
            );
          })}
        </Flex>
      </Box>

      <Flex direction="column" gap="1" px="2" role="group" aria-labelledby="clarify-question">
        {spec.options.map((option, at) => {
          const selected = answer?.kind === 'option' && answer.optionId === option.id;
          return (
            <OptionRow
              key={option.id}
              number={at + 1}
              label={option.label}
              detail={option.detail}
              selected={selected}
              disabled={disabled || applying}
              onPick={() => pick(option.id)}
            />
          );
        })}
        {spec.input === 'nights' && workspace.stops.length > 0 && (
          <NightsInput
            stops={workspace.stops}
            answer={answer?.kind === 'nights' ? answer.stops : []}
            disabled={disabled || applying}
            onChange={(stops) => set(stops.length ? { kind: 'nights', stops } : undefined)}
          />
        )}
        {spec.input && spec.input !== 'nights' && (
          <ValueInput
            kind={spec.input}
            value={inputValue}
            disabled={disabled || applying}
            expected={
              question.id === 'childAges'
                ? answeredChildren(answers, workspace.brief) || null
                : null
            }
            onChange={(value) => set(value ? { kind: 'value', value } : undefined)}
            onDone={() => advance(answers)}
          />
        )}
        <Flex align="center" gap="2" px="2" py="1">
          <Box flexShrink="0" style={{ color: 'var(--gray-10)' }}>
            <Pencil size={14} aria-hidden="true" />
          </Box>
          <Box flexGrow="1" minWidth="0">
            <TextField.Root
              size="2"
              variant="soft"
              color="gray"
              aria-label={`Something else: ${question.label}`}
              placeholder={
                spec.options.length || spec.input
                  ? `Something else — ${spec.placeholder.toLowerCase()}`
                  : spec.placeholder
              }
              value={textValue}
              disabled={disabled || applying}
              maxLength={1000}
              onChange={(event) => {
                const text = event.target.value;
                set(text ? { kind: 'text', text } : undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (textValue.trim()) advance(answers);
                }
              }}
            />
          </Box>
          <Button
            size="2"
            variant="soft"
            color="gray"
            disabled={disabled || applying}
            onClick={skip}
          >
            Skip
          </Button>
        </Flex>
      </Flex>

      <Flex
        align="center"
        justify="between"
        gap="3"
        wrap="wrap"
        px="3"
        py="2"
        mt="1"
        style={{ borderTop: '1px solid var(--gray-a4)' }}
      >
        <Text size="1" color="gray" aria-live="polite">
          {notice ||
            [
              `${answered} answered`,
              skipped ? `${skipped} skipped` : '',
              plan.forTara.length ? `${plan.forTara.length} for Tara to read` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
        </Text>
        <Button
          size="2"
          loading={applying}
          disabled={!answered || disabled || applying}
          onClick={() => void apply()}
        >
          {answered
            ? `Apply ${answered} ${answered === 1 ? 'answer' : 'answers'}`
            : 'Apply answers'}
        </Button>
      </Flex>
      {!!answered && (
        <Box px="3" pb="2">
          <AnswerSummary
            questions={questions}
            answers={answers}
            onJump={(id) => setIndex(questions.findIndex((item) => item.id === id))}
          />
        </Box>
      )}
    </Box>
  );
}

function OptionRow({
  number,
  label,
  detail,
  selected,
  disabled,
  onPick,
}: {
  number: number;
  label: string;
  detail?: string;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
      className="clarify-option"
      data-selected={selected || undefined}
    >
      <span className="clarify-key" aria-hidden="true">
        {selected ? <Check size={12} strokeWidth={3} /> : number}
      </span>
      <span style={{ minWidth: 0 }}>
        <Text as="span" size="2" weight={selected ? 'medium' : 'regular'}>
          {label}
        </Text>
        {detail && (
          <Text as="span" size="1" color="gray" style={{ display: 'block' }}>
            {detail}
          </Text>
        )}
      </span>
    </button>
  );
}

function ValueInput({
  kind,
  value,
  expected,
  disabled,
  onChange,
  onDone,
}: {
  kind: 'date' | 'ages' | 'country';
  value: string;
  expected: number | null;
  disabled: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const ages = kind === 'ages' && value ? parseAges(value) : null;
  const agesHint =
    kind !== 'ages' || !value
      ? ''
      : !ages
        ? 'Ages 0–17, separated by commas. Anything else goes to Tara as written.'
        : expected && ages.length !== expected
          ? `${ages.length} of ${expected} ages — Tara will be asked to confirm.`
          : '';
  return (
    <Box px="2" py="1">
      <TextField.Root
        size="2"
        type={kind === 'date' ? 'date' : 'text'}
        list={kind === 'country' ? 'clarify-countries' : undefined}
        inputMode={kind === 'ages' ? 'numeric' : undefined}
        aria-label={
          kind === 'date' ? 'Arrival date' : kind === 'ages' ? 'Child ages' : 'Passport country'
        }
        placeholder={
          kind === 'ages'
            ? expected
              ? `${expected} ${expected === 1 ? 'age' : 'ages'}, e.g. 6, 9`
              : 'e.g. 6, 9'
            : kind === 'country'
              ? 'Country, e.g. Australia'
              : undefined
        }
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value) {
            event.preventDefault();
            onDone();
          }
        }}
      />
      {kind === 'country' && (
        <datalist id="clarify-countries">
          {studioCountries.map((country) => (
            <option key={country.code} value={country.name} />
          ))}
        </datalist>
      )}
      {agesHint && (
        <Text as="p" size="1" color="gray" mt="1">
          {agesHint}
        </Text>
      )}
    </Box>
  );
}

/* One stepper per stop already on the route, the same control the route editor uses. A stop
   starts at what the route already holds, or blank; only the stops the agent sets are answered. */
function NightsInput({
  stops,
  answer,
  disabled,
  onChange,
}: {
  stops: StudioStop[];
  answer: { id: string; name: string; nights: number }[];
  disabled: boolean;
  onChange: (stops: { id: string; name: string; nights: number }[]) => void;
}) {
  const set = (stop: StudioStop, nights: number | null) => {
    const rest = answer.filter((item) => item.id !== stop.id);
    const next = nights === null ? rest : [...rest, { id: stop.id, name: stop.name, nights }];
    // Route order, so the read-back matches the route.
    onChange(stops.flatMap((s) => next.filter((item) => item.id === s.id)));
  };
  return (
    <Flex direction="column" gap="2" px="2" py="1">
      {stops.map((stop) => {
        const value = answer.find((item) => item.id === stop.id)?.nights ?? stop.nights;
        return (
          <Flex key={stop.id} align="center" justify="between" gap="3">
            <Text size="2" truncate>
              {stop.name}
            </Text>
            <Flex align="center" gap="1" flexShrink="0">
              <IconButton
                size="2"
                variant="soft"
                color="gray"
                aria-label={`One night fewer in ${stop.name}`}
                disabled={disabled || !value || value <= 1}
                onClick={() => set(stop, Math.max(1, (value || 1) - 1))}
              >
                <Minus size={14} />
              </IconButton>
              <TextField.Root
                size="2"
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                placeholder="–"
                aria-label={`Nights to answer for ${stop.name}`}
                value={value ?? ''}
                disabled={disabled}
                style={{ width: 56, textAlign: 'center' }}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  set(
                    stop,
                    event.target.value === '' || !Number.isInteger(n)
                      ? null
                      : Math.min(120, Math.max(1, n)),
                  );
                }}
              />
              <IconButton
                size="2"
                variant="soft"
                color="gray"
                aria-label={`One night more in ${stop.name}`}
                disabled={disabled}
                onClick={() => set(stop, Math.min(120, (value || 0) + 1))}
              >
                <Plus size={14} />
              </IconButton>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}

/* What Apply is about to send, one tap from changing it. */
function AnswerSummary({
  questions,
  answers,
  onJump,
}: {
  questions: StudioQuestion[];
  answers: ClarifyAnswers;
  onJump: (id: string) => void;
}) {
  return (
    <Flex gap="1" wrap="wrap">
      {questions
        .filter((question) => isAnswered(answers[question.id]))
        .map((question) => (
          <Button
            key={question.id}
            size="1"
            variant="soft"
            color="gray"
            onClick={() => onJump(question.id)}
            aria-label={`Change answer to: ${question.label}`}
            style={{ maxWidth: '100%' }}
          >
            <Text truncate>{answerText(question.id, answers[question.id]!)}</Text>
          </Button>
        ))}
    </Flex>
  );
}
