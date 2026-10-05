import { test, expect, type Page, type Request } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import { studioTripBriefingInputKey } from '../shared/studio-trip-briefing';
import { newStudioWorkspace } from '../server/studio-store';
import { applyStudioPatch, qualifyStudio } from '../server/studio-domain';
import { buildStudioClientProposal } from '../server/studio-proposals';
import { fulfilSyntheticTripBriefing } from './studio-trip-briefing-fixture';
import { choose, openStudioClientDesk as openDesk } from './ui-helpers';

const agency = defaultStudioAgency();
function fixture(withRoute = false): StudioWorkspace {
  const workspace = newStudioWorkspace();
  workspace.title = 'Synthetic guided workspace';
  if (withRoute) {
    workspace.stage = 'structure';
    Object.assign(workspace.brief, {
      clientName: 'Synthetic Traveller',
      passportNationality: 'AU',
      tripPurpose: 'tourism',
      tripType: 'multiple',
      outboundTransport: 'flight',
      returnTransport: 'flight',
      startDate: '2027-04-01',
      endDate: '2027-04-07',
      adults: 2,
      children: 0,
      budget: 6000,
      hotelStandard: '4 star',
      interests: ['Gardens'],
    });
    workspace.stops = ['Tokyo', 'Kyoto'].map((name, index) => ({
      id: `synthetic-stop-${index}`,
      name,
      country: 'Japan',
      nights: 3,
      arrivalDate: index ? '2027-04-04' : '2027-04-01',
      departureDate: index ? '2027-04-07' : '2027-04-04',
      onwardTransport: index ? 'undecided' : 'train',
      neighbourhood: '',
      notes: '',
    }));
  }
  workspace.qualification = qualifyStudio(workspace, agency);
  return workspace;
}

async function mockWorkspace(
  page: Page,
  workspace: StudioWorkspace,
  options: {
    briefingGate?: Promise<void>;
    firstBriefingConflict?: boolean;
    reviewGate?: Promise<void>;
  } = {},
) {
  const writes: { path: string; body: Record<string, any> }[] = [];
  const unexpected: string[] = [];
  const failedBriefings = new Set<Request>();
  const abortedBriefings: string[] = [];
  let abandonedBriefings = 0;
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.endsWith('/trip-briefing')) {
      failedBriefings.add(request);
      abortedBriefings.push(request.failure()?.errorText || 'Unknown request failure');
    }
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/config') return json({});
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, hotels: false, flights: false, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency });
    if (path === '/api/studio/clients' || path === '/api/studio/client-profiles')
      return json({ clients: [] });
    if (path === '/api/studio/workspaces') return json({ workspaces: [workspace] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (path === `/api/studio/workspaces/${workspace.id}/proposal/preview` && method === 'GET')
      return json({ proposal: buildStudioClientProposal(workspace, agency) });
    const body = route.request().postDataJSON() || {};
    writes.push({ path, body });
    if (path.endsWith('/trip-briefing')) {
      if (
        options.firstBriefingConflict &&
        writes.filter((write) => write.path === path).length === 1
      ) {
        workspace.revision++;
        workspace.brief.clientName = 'Synthetic concurrent client edit';
        return json({ error: 'Synthetic concurrent edit changed the revision.' }, 409);
      }
      if (options.briefingGate) await options.briefingGate;
      if (failedBriefings.has(route.request())) {
        abandonedBriefings++;
        return;
      }
    }
    if (await fulfilSyntheticTripBriefing(route, workspace)) return;
    if (path === `/api/studio/workspaces/${workspace.id}/review` && options.reviewGate) {
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic foreground review revision changed.' }, 409);
      await options.reviewGate;
      workspace.title = 'Reviewed synthetic route';
      workspace.brief.request = String(body.message);
      workspace.messages.push(
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: String(body.message),
          createdAt: workspace.updatedAt,
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Foreground review saved the planning note.',
          createdAt: workspace.updatedAt,
        },
      );
      workspace.revision++;
      return json({ workspace, nextAction: 'structure' });
    }
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic workspace revision changed.' }, 409);
      applyStudioPatch(workspace, body, agency);
      workspace.revision++;
      workspace.qualification = qualifyStudio(workspace, agency);
      return json({ workspace });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: `Unexpected synthetic request ${method} ${path}` }, 500);
  });
  await page.goto(`/studio/${workspace.id}`);
  return {
    writes,
    unexpected,
    abortedBriefings,
    abandonedBriefings: () => abandonedBriefings,
    briefingWrites: () => writes.filter(({ path }) => path.endsWith('/trip-briefing')),
    briefWrites: () =>
      writes.filter(({ path }) => path === `/api/studio/workspaces/${workspace.id}`),
  };
}

test('a new mobile workspace opens its intake and one actionable question', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = fixture();
  const mocked = await mockWorkspace(page, workspace);
  await expect(page.getByRole('tab', { name: 'Trip workspace', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Client & trip', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Guided brief', exact: true })).toBeVisible();
  await expect(page.getByTestId('studio-next-question')).toContainText('Where would you like');
  await expect(page.getByRole('form', { name: 'Answer brief question', exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole('tab', { name: 'Accommodation', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('region', { name: 'Cruise itinerary import', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Research destinations', exact: true }),
  ).toHaveCount(0);
  expect(mocked.writes).toEqual([]);
  await expect(page.getByRole('region', { name: 'Proposal canvas', exact: true })).toHaveCSS(
    'opacity',
    '1',
  );
  await page.screenshot({ path: '/tmp/asktara-guided-mobile.png' });
  await expect(
    page
      .getByRole('region', { name: 'Guided brief', exact: true })
      .getByRole('heading', { name: 'Where would you like the client to travel?', exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(mocked.unexpected).toEqual([]);
});

test('common party answers save directly by keyboard and advance to the next question', async ({
  page,
}) => {
  const workspace = fixture(true);
  workspace.brief.adults = null;
  workspace.brief.children = null;
  workspace.qualification = qualifyStudio(workspace, agency);
  const mocked = await mockWorkspace(page, workspace);
  await page.getByRole('tab', { name: 'Client & trip', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Guided brief', exact: true });
  await expect(page.getByTestId('studio-next-question')).toContainText('How many adults');
  const twoAdults = guide.getByRole('button', { name: '2 adults', exact: true });
  await twoAdults.focus();
  await twoAdults.press('Enter');
  await expect(page.getByTestId('studio-next-question')).toContainText('Are any children');
  await expect(
    guide.getByRole('heading', { name: 'Are any children travelling this time?', exact: true }),
  ).toBeFocused();
  await guide.getByRole('button', { name: 'No children', exact: true }).click();
  await expect.poll(() => workspace.brief.adults).toBe(2);
  await expect.poll(() => workspace.brief.children).toBe(0);
  expect(mocked.briefWrites().map(({ body }) => body.brief)).toEqual([
    { adults: 2 },
    { children: 0, childAges: [] },
  ]);
  expect(mocked.writes.some(({ path }) => path.endsWith('/review'))).toBe(false);
  await page.reload();
  expect(workspace.brief.adults).toBe(2);
  expect(workspace.brief.children).toBe(0);
  await expect(page.getByRole('tab', { name: 'Accommodation', exact: true })).toBeDisabled();
  expect(mocked.unexpected).toEqual([]);
});

test('mobile pane switching retains desk and chat drafts, and saving persists only explicit details', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = fixture();
  const mocked = await mockWorkspace(page, workspace);
  const desk = await openDesk(page);
  await desk.getByRole('textbox', { name: 'Client name', exact: true }).fill('Synthetic Family');
  await page.getByRole('tab', { name: 'Chat with Tara', exact: true }).click();
  const message = page.getByRole('textbox', {
    name: 'Client request or planning notes',
    exact: true,
  });
  await message.fill('Draft client request');
  await message.press('Shift+Enter');
  await message.press('Tab');
  await page.getByRole('tab', { name: 'Trip workspace', exact: true }).click();
  await expect(desk.getByRole('textbox', { name: 'Client name', exact: true })).toHaveValue(
    'Synthetic Family',
  );
  await desk.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect.poll(() => workspace.brief.clientName).toBe('Synthetic Family');
  expect(mocked.briefWrites().map(({ body }) => body.brief)).toEqual([
    { clientName: 'Synthetic Family' },
  ]);
  expect(workspace.brief.adults).toBeNull();
  expect(workspace.brief.children).toBeNull();
  await page.getByRole('tab', { name: 'Chat with Tara', exact: true }).click();
  await expect(message).toHaveValue('Draft client request\n');
  await page.reload();
  await page.getByRole('tab', { name: 'Trip workspace', exact: true }).click();
  const persistedDesk = await openDesk(page);
  await expect(
    persistedDesk.getByRole('textbox', { name: 'Client name', exact: true }),
  ).toHaveValue('Synthetic Family');
  expect(mocked.unexpected).toEqual([]);
});

test('dated destinations load sourced entry and seasonal weather automatically, refresh changed passport, and reuse persisted checks', async ({
  page,
}) => {
  const workspace = fixture(true);
  const mocked = await mockWorkspace(page, workspace);
  await expect.poll(() => mocked.briefingWrites().length).toBe(1);
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Synthetic seasonal outlook for Tokyo',
  );
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Synthetic seasonal outlook for Kyoto',
  );
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Synthetic entry advice for Australia passport in Tokyo',
  );
  const tokyo = page.getByRole('article', { name: 'Tokyo travel briefing', exact: true });
  await tokyo.getByText('Sources & details', { exact: true }).click();
  await expect(
    tokyo.getByRole('link', { name: 'Synthetic immigration source', exact: true }),
  ).toHaveAttribute('href', 'https://immigration.example.test/entry');
  await expect(
    tokyo.getByRole('link', { name: 'Synthetic climate source', exact: true }),
  ).toHaveAttribute('href', 'https://climate.example.test/outlook');
  await expect(tokyo).toContainText('Usual patterns, not a forecast for these dates.');
  expect(workspace.tripBriefing?.stops).toHaveLength(2);
  expect(
    workspace.tripBriefing?.stops.every((stop) => stop.weather.kind === 'seasonal_outlook'),
  ).toBe(true);
  await page.screenshot({ path: '/tmp/asktara-guided-desktop.png' });
  const desk = await openDesk(page);
  await desk
    .getByRole('combobox', { name: 'Passport nationality for this trip', exact: true })
    .selectOption('PK');
  await desk.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect.poll(() => mocked.briefingWrites().length).toBe(2);
  expect(workspace.tripBriefing?.inputKey).toBe(studioTripBriefingInputKey(workspace));
  expect(
    workspace.tripBriefing?.stops.every(
      (stop) => stop.entryRequirements?.passportCountryCode === 'PK',
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Synthetic entry advice for Pakistan passport in Tokyo',
  );
  expect(mocked.briefingWrites()).toHaveLength(2);
  expect(
    mocked.writes.filter(({ path }) => /entry-requirements|destinations\/research/.test(path)),
  ).toEqual([]);
  expect(mocked.unexpected).toEqual([]);
});

test('automatic weather still appears when passport information is missing', async ({ page }) => {
  const workspace = fixture(true);
  workspace.brief.passportNationality = '';
  workspace.qualification = qualifyStudio(workspace, agency);
  const mocked = await mockWorkspace(page, workspace);
  await expect.poll(() => mocked.briefingWrites().length).toBe(1);
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Add the passport nationality',
  );
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Synthetic seasonal outlook for Tokyo',
  );
  expect(workspace.tripBriefing?.status).toBe('partial');
  expect(workspace.tripBriefing?.stops.every((stop) => stop.entryRequirements === null)).toBe(true);
  expect(mocked.unexpected).toEqual([]);
});

test('a briefing finishing during route edits preserves the draft and saves with the current revision', async ({
  page,
}) => {
  const workspace = fixture(true);
  let release!: () => void;
  const briefingGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mocked = await mockWorkspace(page, workspace, { briefingGate });
  try {
    await expect.poll(() => mocked.briefingWrites().length).toBe(1);
    const notes = page.getByRole('textbox', { name: 'Notes for Tokyo', exact: true });
    await notes.fill('Keep this unsaved route note.');
    await expect(
      page.getByRole('button', { name: 'Save route changes', exact: true }),
    ).toBeVisible();
    release();
    await expect(page.getByTestId('studio-travel-briefing')).toContainText(
      'Synthetic seasonal outlook for Tokyo',
    );
    await expect(notes).toHaveValue('Keep this unsaved route note.');
    await page.getByRole('button', { name: 'Save route changes', exact: true }).click();
    await expect.poll(() => workspace.stops[0].notes).toBe('Keep this unsaved route note.');
    expect(mocked.briefWrites()[0].body.revision).toBe(2);
    await expect(page.getByRole('button', { name: 'Save route changes', exact: true })).toHaveCount(
      0,
    );
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Notes for Tokyo', exact: true })).toHaveValue(
      'Keep this unsaved route note.',
    );
    expect(mocked.unexpected).toEqual([]);
  } finally {
    release();
  }
});

test('one revision conflict retries the automatic briefing against the refreshed workspace', async ({
  page,
}) => {
  const workspace = fixture(true);
  const mocked = await mockWorkspace(page, workspace, { firstBriefingConflict: true });
  await expect.poll(() => mocked.briefingWrites().length).toBe(2);
  await expect(page.getByTestId('studio-travel-briefing')).toContainText(
    'Synthetic seasonal outlook for Tokyo',
  );
  expect(mocked.briefingWrites().map(({ body }) => body.revision)).toEqual([1, 2]);
  expect(workspace.brief.clientName).toBe('Synthetic concurrent client edit');
  expect(workspace.tripBriefing?.inputKey).toBe(studioTripBriefingInputKey(workspace));
  expect(mocked.unexpected).toEqual([]);
});

test('a background briefing preserves unsaved package pricing and its save uses the new revision', async ({
  page,
}) => {
  const workspace = fixture(true);
  workspace.structureAccepted = true;
  workspace.stage = 'services';
  let release!: () => void;
  const briefingGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mocked = await mockWorkspace(page, workspace, { briefingGate });
  try {
    await expect.poll(() => mocked.briefingWrites().length).toBe(1);
    await page.getByRole('tab', { name: 'Proposal', exact: true }).click();
    await choose(
      page,
      page.getByRole('combobox', { name: 'Proposal format', exact: true }),
      'Show one package price',
    );
    const price = page.getByRole('spinbutton', { name: 'Total package price', exact: true });
    await price.fill('7890');
    await page
      .getByRole('textbox', { name: 'Client-facing pricing notes', exact: true })
      .fill('Keep this unsaved pricing note.');
    const briefingResponse = page.waitForResponse((response) =>
      response.url().endsWith('/trip-briefing'),
    );
    release();
    await briefingResponse;
    await expect(price).toHaveValue('7890');
    await expect(
      page.getByRole('textbox', { name: 'Client-facing pricing notes', exact: true }),
    ).toHaveValue('Keep this unsaved pricing note.');
    await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
    await expect.poll(() => workspace.pricing.packagePrice).toBe(7890);
    expect(mocked.briefWrites()[0].body.revision).toBe(2);
    await page.reload();
    await page.getByRole('tab', { name: 'Proposal', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: 'Total package price', exact: true }),
    ).toHaveValue('7890');
    expect(mocked.unexpected).toEqual([]);
  } finally {
    release();
  }
});

test('a background travel briefing retains the reviewed client preview and its privacy boundary', async ({
  page,
}) => {
  const workspace = fixture(true);
  workspace.structureAccepted = true;
  workspace.stage = 'services';
  workspace.brief.context = 'PRIVATE_SYNTHETIC_CLIENT_BACKGROUND';
  let release!: () => void;
  const briefingGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mocked = await mockWorkspace(page, workspace, { briefingGate });
  try {
    await expect.poll(() => mocked.briefingWrites().length).toBe(1);
    await page.getByRole('tab', { name: 'Proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
    const preview = page.getByTestId('client-proposal');
    await expect(preview).toContainText('Synthetic guided workspace');
    const briefingResponse = page.waitForResponse((response) =>
      response.url().endsWith('/trip-briefing'),
    );
    release();
    await briefingResponse;
    await expect(preview).toBeVisible();
    await expect(preview).not.toContainText('PRIVATE_SYNTHETIC_CLIENT_BACKGROUND');
    await expect(preview).not.toContainText('Synthetic entry advice');
    await expect(preview).not.toContainText('Synthetic climate source');
    expect(mocked.unexpected).toEqual([]);
  } finally {
    release();
  }
});

test('a foreground review cancels pending research and automatic checks resume on the reviewed revision', async ({
  page,
}) => {
  const workspace = fixture(true);
  let releaseBriefing!: () => void;
  let releaseReview!: () => void;
  const briefingGate = new Promise<void>((resolve) => {
    releaseBriefing = resolve;
  });
  const reviewGate = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  const mocked = await mockWorkspace(page, workspace, { briefingGate, reviewGate });
  try {
    await expect.poll(() => mocked.briefingWrites().length).toBe(1);
    await page
      .getByRole('textbox', { name: 'Client request or planning notes', exact: true })
      .fill('Keep the confirmed route and add a quiet-pace planning note.');
    const reviewResponse = page.waitForResponse((response) => response.url().endsWith('/review'));
    await page.getByRole('button', { name: 'Review brief', exact: true }).click();
    await expect.poll(() => mocked.abortedBriefings.length).toBe(1);
    expect(mocked.abortedBriefings[0]).toMatch(/ERR_ABORTED|NS_BINDING_ABORTED|aborted|cancelled/i);
    releaseBriefing();
    await expect.poll(mocked.abandonedBriefings).toBe(1);
    expect(workspace.revision).toBe(1);
    releaseReview();
    expect((await reviewResponse).status()).toBe(200);
    await expect(page.getByRole('log')).toContainText('Foreground review saved the planning note.');
    await expect.poll(() => mocked.briefingWrites().length).toBe(2);
    await expect(page.getByTestId('studio-travel-briefing')).toContainText(
      'Synthetic seasonal outlook for Tokyo',
    );
    expect(mocked.briefingWrites().map(({ body }) => body.revision)).toEqual([1, 2]);
    await expect(
      page.getByRole('heading', { name: 'Reviewed synthetic route', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('log')).toContainText('Foreground review saved the planning note.');
    expect(mocked.unexpected).toEqual([]);
  } finally {
    releaseBriefing();
    releaseReview();
  }
});

test('profile editing drafts survive desk tabs and disclosure while hidden controls stay out of the workspace', async ({
  page,
}) => {
  const workspace = fixture();
  const mocked = await mockWorkspace(page, workspace);
  const desk = await openDesk(page);
  await desk.getByText('Client profiles · new or returning', { exact: true }).click();
  await desk.getByRole('button', { name: 'New client profile', exact: true }).click();
  const profile = desk.getByRole('form', { name: 'Client profile', exact: true });
  await profile
    .getByRole('textbox', { name: 'Profile name', exact: true })
    .fill('Synthetic draft traveller');
  await profile
    .getByRole('textbox', { name: 'Background and preferences', exact: true })
    .fill('PRIVATE_UNSAVED_PROFILE_CONTEXT');
  await desk.getByRole('tab', { name: 'Trip', exact: true }).click();
  await expect(profile).not.toBeVisible();
  const destination = desk.getByRole('textbox', { name: 'Destination in mind', exact: true });
  await destination.focus();
  await expect(destination).toBeFocused();
  await desk.getByRole('tab', { name: 'Client', exact: true }).click();
  await expect(profile.getByRole('textbox', { name: 'Profile name', exact: true })).toHaveValue(
    'Synthetic draft traveller',
  );
  await page.getByRole('tab', { name: 'Route', exact: true }).click();
  await expect(profile).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Guided brief', exact: true })).not.toBeVisible();
  await page.getByRole('tab', { name: 'Client & trip', exact: true }).click();
  await expect(profile.getByRole('textbox', { name: 'Profile name', exact: true })).toHaveValue(
    'Synthetic draft traveller',
  );
  const heading = desk.getByRole('button', { name: /^Customer desk/ });
  await heading.click();
  await expect(profile).not.toBeVisible();
  await expect(desk.getByRole('tab', { name: 'Client', exact: true })).not.toBeVisible();
  await heading.click();
  await expect(profile.getByRole('textbox', { name: 'Profile name', exact: true })).toHaveValue(
    'Synthetic draft traveller',
  );
  await expect(
    profile.getByRole('textbox', { name: 'Background and preferences', exact: true }),
  ).toHaveValue('PRIVATE_UNSAVED_PROFILE_CONTEXT');
  expect(mocked.writes).toEqual([]);
  expect(mocked.unexpected).toEqual([]);
});
