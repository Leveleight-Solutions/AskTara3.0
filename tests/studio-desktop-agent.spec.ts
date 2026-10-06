import { expect, test, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import type { StudioClientProfile } from '../shared/studio-clients';
import { newStudioWorkspace } from '../server/studio-store';
import { applyStudioPatch, qualifyStudio } from '../server/studio-domain';
import { fulfilSyntheticTripBriefing } from './studio-trip-briefing-fixture';

const profile: StudioClientProfile = {
  id: 'dc000000-0000-4000-8000-000000000001',
  name: 'Fictional Desktop Traveller',
  country: 'AU',
  nationality: 'AU',
  passportNationality: 'AU',
  dateOfBirth: '1988-07-12',
  photoDataUrl: '',
  context: 'Quiet, unhurried holidays.',
  interests: ['Gardens'],
  foodPreferences: ['Vegetarian'],
  history: [
    {
      destination: 'Kyoto',
      country: 'JP',
      experience: 'visited',
      feedback: 'liked',
      notes: 'Loved the quiet gardens.',
    },
  ],
  updatedAt: new Date().toISOString(),
};
function fixture(withPlan = true) {
  const workspace = newStudioWorkspace();
  workspace.title = 'Desktop agent verification';
  Object.assign(workspace.brief, {
    clientId: profile.id,
    clientName: profile.name,
    interests: profile.interests,
    foodPreferences: profile.foodPreferences,
    passportNationality: 'AU',
    tripPurpose: 'tourism',
    currency: 'AUD',
    budget: 5000,
  });
  if (withPlan) {
    Object.assign(workspace.brief, {
      startDate: '2027-04-01',
      endDate: '2027-04-04',
      adults: 2,
      children: 0,
      childAges: [],
      hotelStandard: '4 star',
      hotelLocation: 'Central',
    });
    workspace.stops = [
      {
        id: 'desktop-london',
        name: 'London',
        country: 'GB',
        nights: 3,
        arrivalDate: '2027-04-01',
        departureDate: '2027-04-04',
        onwardTransport: 'undecided',
        neighbourhood: '',
        notes: '',
      },
    ];
    workspace.structureAccepted = true;
    workspace.stage = 'itinerary';
    workspace.itinerary = {
      generatedAt: new Date().toISOString(),
      notes: [],
      days: [1, 2, 3, 4].map((day) => ({
        day,
        date: `2027-04-0${day}`,
        stopIds: ['desktop-london'],
        title: `London day ${day}`,
        summary: 'Leave room for unhurried exploration.',
        activities: [
          {
            period: 'flexible',
            title: `Garden visit ${day}`,
            description: 'A researched garden stop with time to rest.',
            sources: [
              {
                label: 'Synthetic garden source',
                url: 'https://gardens.example.test/visit',
                checkedAt: new Date().toISOString(),
              },
            ],
          },
        ],
      })),
    };
    // Stable source identity must survive a single-day edit.
    workspace.itinerary.days[1].cruiseId = 'reviewed-sailing';
    workspace.itinerary.days[1].cruiseDayId = 'port-row-2';
    workspace.recommendations = [
      {
        id: 'desktop-food',
        stopId: 'desktop-london',
        name: 'Vegetarian riverside lunch',
        category: 'food',
        description: 'A fictional sourced lunch option.',
        sources: [
          {
            label: 'Synthetic restaurant source',
            url: 'https://food.example.test/menu',
            checkedAt: new Date().toISOString(),
          },
        ],
        included: false,
      },
    ];
  }
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  return workspace;
}
async function mock(
  page: Page,
  workspace: StudioWorkspace,
  options: { briefingGate?: Promise<void> } = {},
) {
  const writes: { path: string; body: any }[] = [],
    unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, hotels: true, flights: true, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === '/api/studio/client-profiles') return json({ clients: [profile] });
    if (path === `/api/studio/client-profiles/${profile.id}/history`)
      return json({ history: profile.history });
    if (path === '/api/studio/workspaces') return json({ workspaces: [workspace] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    const body = route.request().postDataJSON() || {};
    writes.push({ path, body });
    if (path.endsWith('/trip-briefing') && options.briefingGate) await options.briefingGate;
    if (await fulfilSyntheticTripBriefing(route, workspace)) return;
    if (path.endsWith('/destinations/research')) {
      workspace.destinationResearch = {
        generatedAt: new Date().toISOString(),
        inputKey: 'synthetic-inspiration',
        passportNationality: 'AU',
        warnings: [],
        candidates: [
          {
            destination: 'Lisbon',
            country: 'Portugal',
            countryCode: 'PT',
            reason: 'Gardens and vegetarian food fit the supplied preferences.',
            suggestedDays: 5,
            status: 'caution',
            recommendable: true,
            sources: [],
            seasonalNotes: '',
            travelAdvice: '',
          },
        ],
      } as any;
      workspace.revision++;
      return json({ workspace });
    }
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      expect(body.revision).toBe(workspace.revision);
      applyStudioPatch(workspace, body, defaultStudioAgency());
      workspace.revision++;
      workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
      return json({ workspace });
    }
    if (path.endsWith('/recommendations/desktop-food/add-to-day')) {
      expect(body.revision).toBe(workspace.revision);
      const recommendation = workspace.recommendations[0],
        day = workspace.itinerary!.days.find((d) => d.day === body.day)!;
      day.activities.push({
        period: body.period,
        title: recommendation.name,
        description: recommendation.description,
        sources: recommendation.sources,
      });
      workspace.revision++;
      workspace.itineraryManual = true;
      return json({ workspace, inserted: true });
    }
    if (path.endsWith('/itinerary')) {
      workspace.revision++;
      return json({ workspace });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic request' }, 500);
  });
  return { writes, unexpected };
}

test('desktop conversation shows client-history suggestions above chat and a compact editable canvas', async ({
  page,
}) => {
  const workspace = fixture(false),
    mocked = await mock(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await expect(
    page.getByRole('region', { name: 'Selected client and personalised inspiration' }),
  ).toContainText(profile.name);
  await expect(
    page.getByRole('region', { name: 'Selected client and personalised inspiration' }),
  ).toContainText('Inspired by their travel history');
  const suggestion = page.getByRole('button', { name: /Lisbon.*suggested days/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByTestId('studio-trip-board')).toContainText('Lisbon');
  expect(workspace.brief.adults).toBeNull();
  expect(workspace.brief.children).toBeNull();
  expect(workspace.brief.startDate).toBe('');
  expect(workspace.stops[0].nights).toBe(4);
  await expect(page.getByRole('tablist', { name: 'Plan details' })).not.toBeVisible();
  await expect(page.getByLabel('Date of birth', { exact: true })).not.toBeVisible();
  await page.screenshot({
    path: '/private/tmp/asktara-desktop-chat-inspiration.png',
    fullPage: true,
  });
  expect(mocked.unexpected).toEqual([]);
});

test('chat can add a sourced food choice to a specific day, edit it repeatedly and persist every other day', async ({
  page,
}) => {
  const workspace = fixture(),
    mocked = await mock(page, workspace),
    before = structuredClone(workspace.itinerary!.days);
  await page.goto(`/studio/${workspace.id}`);
  await page
    .getByRole('region', { name: 'Researched activity and food choices' })
    .getByRole('button', { name: 'Add to a day', exact: true })
    .click();
  const add = page.getByRole('dialog', { name: 'Add Vegetarian riverside lunch' });
  await add.getByLabel('Itinerary day', { exact: true }).selectOption('2');
  await add.getByLabel('Time of day', { exact: true }).selectOption('afternoon');
  await add.getByRole('button', { name: 'Add to itinerary', exact: true }).click();
  await expect(add).not.toBeVisible();
  const board = page.getByTestId('studio-trip-board');
  const first = board.getByRole('tab', { name: 'Day 1', exact: true });
  await first.focus();
  await first.press('ArrowRight');
  await expect(board.getByRole('tab', { name: 'Day 2', exact: true })).toBeFocused();
  await expect(board.getByRole('tab', { name: 'Day 2', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await board.getByRole('tab', { name: 'Day 2', exact: true }).click();
  await expect(board).toContainText('Vegetarian riverside lunch');
  await board.getByRole('button', { name: 'Edit day 2', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit day 2', exact: true });
  await edit.getByLabel('Day title', { exact: true }).fill('A slower London day');
  await edit.getByRole('button', { name: 'Save day', exact: true }).click();
  await expect(edit).not.toBeVisible();
  expect(workspace.itinerary!.days[1]).toMatchObject({
    title: 'A slower London day',
    cruiseId: 'reviewed-sailing',
    cruiseDayId: 'port-row-2',
  });
  expect(workspace.itinerary!.days[1].activities[1].sources).toHaveLength(1);
  expect([workspace.itinerary!.days[0], ...workspace.itinerary!.days.slice(2)]).toEqual([
    before[0],
    ...before.slice(2),
  ]);
  await page.reload();
  await board.getByRole('tab', { name: 'Day 2', exact: true }).click();
  await expect(board).toContainText('A slower London day');
  await board.getByRole('button', { name: 'Edit day 2', exact: true }).click();
  await edit.getByLabel('Day notes', { exact: true }).fill('Room for an afternoon rest.');
  await edit.getByRole('button', { name: 'Save day', exact: true }).click();
  await expect(edit).not.toBeVisible();
  expect(workspace.itinerary!.days[1].summary).toBe('Room for an afternoon rest.');
  await expect(page.getByRole('tablist', { name: 'Plan details' })).not.toBeVisible();
  await page.screenshot({
    path: '/private/tmp/asktara-desktop-itinerary-canvas.png',
    fullPage: true,
  });
  expect(mocked.unexpected).toEqual([]);
  expect(mocked.writes.some(({ path }) => /book|publish|payment|reserve/.test(path))).toBe(false);
});

test('a day popup keeps the typed draft when automatic travel metadata finishes and saves the latest revision', async ({
  page,
}) => {
  const workspace = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mocked = await mock(page, workspace, { briefingGate: gate });
  await page.goto(`/studio/${workspace.id}`);
  await page.getByRole('button', { name: 'Edit day 1', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit day 1', exact: true });

  await edit.getByLabel('Day notes', { exact: true }).fill('Keep my typed afternoon-rest draft.');
  await expect
    .poll(() => mocked.writes.some(({ path }) => path.endsWith('/trip-briefing')))
    .toBe(true);
  release();
  await expect.poll(() => workspace.revision).toBeGreaterThan(0);
  await expect(edit.getByLabel('Day notes', { exact: true })).toHaveValue(
    'Keep my typed afternoon-rest draft.',
  );
  await expect(edit.getByRole('button', { name: 'Save day', exact: true })).toBeEnabled();
  await edit.getByRole('button', { name: 'Save day', exact: true }).click();
  await expect(edit).not.toBeVisible();
  expect(workspace.itinerary!.days[0].summary).toBe('Keep my typed afternoon-rest draft.');
  expect(mocked.unexpected).toEqual([]);
});

test('1024px desktop keeps both panes usable without horizontal overflow and puts dense route editing in a popup', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 850 });
  const workspace = fixture(),
    mocked = await mock(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await expect(page.getByRole('complementary', { name: 'Planning conversation' })).toBeVisible();
  await expect(page.getByTestId('studio-trip-board')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.getByRole('button', { name: 'Edit route', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit route', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tablist', { name: 'Plan details' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(mocked.unexpected).toEqual([]);
});

test('missing party details use popup choices that save declared facts without another model call', async ({
  page,
}) => {
  const workspace = fixture();
  workspace.brief.adults = null;
  workspace.brief.children = null;
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  const mocked = await mock(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  const actions = page.getByRole('region', { name: 'Tara planning actions' });
  await actions.getByRole('button', { name: 'Choose an answer', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Choose trip details', exact: true });
  await dialog.getByRole('button', { name: '5 adults', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(workspace.brief.adults).toBe(5);
  expect(workspace.brief.children).toBeNull();
  await actions.getByRole('button', { name: 'Choose an answer', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Choose trip details', exact: true });
  await dialog.getByRole('button', { name: 'No children', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(workspace.brief.children).toBe(0);
  expect(workspace.brief.childAges).toEqual([]);
  expect(mocked.writes.filter(({ path }) => path.endsWith('/review'))).toEqual([]);
  expect(mocked.unexpected).toEqual([]);
});

test('changing the declared budget refreshes automatic client inspiration without copying identity or old party', async ({
  page,
}) => {
  const workspace = fixture(false),
    mocked = await mock(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await expect(page.getByRole('button', { name: /Lisbon.*suggested days/ })).toBeVisible();
  const before = mocked.writes.filter(({ path }) => path.endsWith('/destinations/research')).length;
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Client brief', exact: true });
  await dialog.getByLabel('Total group budget', { exact: true }).fill('8000');
  await dialog.getByRole('button', { name: 'Save brief', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => mocked.writes.filter(({ path }) => path.endsWith('/destinations/research')).length)
    .toBeGreaterThan(before);
  expect(workspace.brief.budget).toBe(8000);
  expect(workspace.brief.adults).toBeNull();
  expect(workspace.brief.children).toBeNull();
  expect(
    mocked.writes
      .filter(({ path }) => path.endsWith('/destinations/research'))
      .every(({ body }) => !JSON.stringify(body).includes(profile.dateOfBirth!)),
  ).toBe(true);
  expect(mocked.unexpected).toEqual([]);
});

test('unverified history-based ideas remain visible for review and cannot be chosen as checked recommendations', async ({
  page,
}) => {
  const workspace = fixture(false);
  workspace.destinationResearch = {
    generatedAt: new Date().toISOString(),
    inputKey: 'unverified-inspiration',
    passportNationality: 'AU',
    warnings: [],
    candidates: [
      {
        destination: 'Coimbra',
        country: 'Portugal',
        countryCode: 'PT',
        reason: 'Quiet gardens fit the supplied travel feedback.',
        suggestedDays: 5,
        status: 'unverified',
        recommendable: false,
        sources: [],
        seasonalNotes: '',
        travelAdvice: '',
      },
    ],
  } as any;
  await mock(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  const inspiration = page.getByRole('region', {
    name: 'Selected client and personalised inspiration',
  });
  await expect(inspiration).toContainText('Coimbra');
  await expect(inspiration).toContainText('Current advice needs review');
  await expect(inspiration.getByRole('button', { name: /Coimbra.*Choose/ })).toHaveCount(0);
  expect(workspace.stops).toHaveLength(0);
});
