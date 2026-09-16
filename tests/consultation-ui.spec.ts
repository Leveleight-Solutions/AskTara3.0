import { test, expect, type Locator, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultConsultation } from '../shared/consultation';
import { defaultTravelProfile } from '../shared/account';
import type { Trip } from '../shared/types';

/** Radix Select has no native <select>: open the trigger, then pick the option by its label. */
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}
const tripId = '30000000-0000-4000-8000-000000000001';
/** Radix DataList renders each budget row as <div><dt>label</dt><dd>value</dd></div>. */
const budgetRow = (page: Page, label: string) =>
  page
    .getByTestId('budget-breakdown')
    .locator('dt')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::dd[1]');
const timestamp = '2026-09-13T12:00:00Z';
function consultationTrip(): Trip {
  const consultation = defaultConsultation();
  consultation.facts.destination = {
    source: 'message',
    evidence: 'London',
    valueState: 'specified',
  };
  return {
    id: tripId,
    title: 'London, your way',
    destinationId: 'london',
    startDate: '',
    days: 5,
    travelers: 2,
    budget: 1500,
    interests: [],
    status: 'draft',
    revision: 1,
    brief: {
      pace: 'balanced',
      originAirport: '',
      arrivalAirport: '',
      guestNationality: '',
      includeFlights: false,
      includeHotels: false,
      destinationStops: [],
      notes: [],
      consultation,
    },
    itinerary: [],
    shareToken: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      { id: 'user-1', role: 'user', content: 'I’d like to visit London.', createdAt: timestamp },
      {
        id: 'assistant-1',
        role: 'assistant',
        content:
          'London sounds lovely. Would you like help with flights and accommodation, or have you already sorted those?',
        createdAt: timestamp,
      },
    ],
    planning: {
      generatedAt: timestamp,
      mode: 'local',
      summary: 'A few details will help tailor this trip.',
      assumptions: [],
      issues: [],
      sources: [],
      places: [],
      stays: [],
      flights: [],
      destinations: [],
      agentIds: ['intake'],
      questions: [
        {
          field: 'flights',
          question: 'Would you like help finding flights?',
          suggestions: [
            'Find flights for me',
            'My flights are already booked',
            'No flights needed',
          ],
        },
        {
          field: 'hotels',
          question: 'Would you like help with accommodation?',
          suggestions: ['Find hotels for me', 'My hotels are already booked', 'No hotels needed'],
        },
      ],
      budget: {
        currency: 'USD',
        targetCurrency: 'AUD',
        target: 1500,
        activities: 0,
        accommodation: 0,
        flights: null,
        total: 0,
        unpriced: ['Flights', 'Accommodation'],
      },
    },
  };
}
async function mockConsultation(page: Page, trip: Trip) {
  const patches: Record<string, unknown>[] = [];
  const prompts: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/config') return json({});
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/trips') return json({ trips: [trip] });
    if (path === '/api/integrations')
      return json({ ai: true, flights: false, hotels: false, activities: false, mode: 'live' });
    if (path === `/api/trips/${tripId}` && method === 'GET') return json({ trip });
    if (path === `/api/trips/${tripId}/runs`) return json({ runs: [] });
    if (path === `/api/trips/${tripId}` && method === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(body);
      Object.assign(trip, body, { revision: trip.revision! + 1 });
      const fields = {
        startDate: 'dates',
        days: 'duration',
        travelers: 'travelers',
        budget: 'budget',
      } as const;
      for (const [key, field] of Object.entries(fields))
        if (key in body)
          trip.brief!.consultation!.facts[field] = {
            source: 'form',
            evidence: 'Trip settings',
            valueState: 'specified',
          };
      trip.planning!.budget.target = trip.budget;
      trip.planning!.budget.targetCurrency = trip.brief!.consultation!.currency;
      return json({ trip });
    }
    if (path === '/api/planning/runs' && method === 'POST') {
      prompts.push(route.request().postDataJSON().message);
      return json({ error: 'Consultation fixture paused after receiving your answer.' }, 503);
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected fixture request' }, 500);
  });
  return { patches, prompts, unexpected };
}

for (const mobile of [false, true]) {
  test(`consultation keeps defaults unknown and saves explicit services and AUD budget (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const trip = consultationTrip();
    const fixture = await mockConsultation(page, trip);
    await page.goto(`/chat/${tripId}`);
    if (mobile) await page.getByRole('tab', { name: 'Your itinerary', exact: true }).click();
    const summary = page.getByTestId('consultation-summary');
    await expect(summary.getByRole('heading', { name: 'Let’s plan London.' })).toBeVisible();
    await expect(summary).not.toContainText('2 travellers');
    await expect(summary).not.toContainText('5 days');
    await expect(summary).not.toContainText('1,500');
    await page.getByRole('button', { name: 'Edit trip details' }).click();
    let dialog = page.getByRole('dialog', { name: 'Make it your kind of trip' });
    await expect(dialog.getByLabel('Number of days', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Travelers', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Total group budget (AUD)', { exact: true })).toHaveValue('');
    await expect(dialog.getByRole('combobox', { name: 'Flights', exact: true })).toHaveText(
      'Not discussed',
    );
    await expect(dialog.getByRole('combobox', { name: 'Accommodation', exact: true })).toHaveText(
      'Not discussed',
    );
    await dialog.getByLabel('Trip name', { exact: true }).fill('London, with room to explore');
    await dialog.getByRole('button', { name: 'Save trip details' }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.patches).toEqual([{ title: 'London, with room to explore', revision: 1 }]);
    await page.getByRole('button', { name: 'Edit trip details' }).click();
    dialog = page.getByRole('dialog', { name: 'Make it your kind of trip' });
    await choose(page, dialog.getByRole('combobox', { name: 'Flights', exact: true }), 'Need help');
    await choose(
      page,
      dialog.getByRole('combobox', { name: 'Accommodation', exact: true }),
      'Already booked',
    );
    await dialog.getByLabel('From airport', { exact: true }).fill('SYD');
    await dialog.getByLabel('To airport', { exact: true }).fill('LHR');
    await dialog.getByLabel('Number of days', { exact: true }).fill('8');
    await dialog.getByLabel('Travelers', { exact: true }).fill('3');
    await dialog.getByLabel('Total group budget (AUD)', { exact: true }).fill('12000');
    await dialog.getByRole('button', { name: 'Save trip details' }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.patches[1]).toMatchObject({
      days: 8,
      travelers: 3,
      budget: 12000,
      brief: {
        includeFlights: true,
        includeHotels: false,
        consultation: {
          currency: 'AUD',
          services: {
            flights: { status: 'requested', source: 'form' },
            hotels: { status: 'already_booked', source: 'form' },
          },
        },
      },
    });
    await page.reload();
    if (mobile) await page.getByRole('tab', { name: 'Your itinerary', exact: true }).click();
    await expect(summary).toContainText('8 days');
    await expect(summary).toContainText('3 travellers');
    await expect(summary).toContainText('A$12,000 AUD');
    await expect(summary).toContainText('Already booked');
    await expect(summary).toContainText('Need help');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`consultation-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
    });
    if (mobile) await page.getByRole('tab', { name: 'Chat with Tara', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Find flights for me', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Continue planning', exact: true }),
    ).toBeVisible();
    expect(fixture.unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('consultation reply chips send the selected answer unchanged and do not imply another service choice', async ({
  page,
}) => {
  const trip = consultationTrip();
  const fixture = await mockConsultation(page, trip);
  await page.goto(`/chat/${tripId}`);
  await page.getByRole('button', { name: 'My flights are already booked', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Consultation fixture paused');
  expect(fixture.prompts).toEqual(['My flights are already booked']);
  expect(trip.brief!.consultation!.services.hotels.status).toBe('unknown');
  expect(fixture.unexpected).toEqual([]);
});

test('saved draft cards do not present seeded dates, length or party as customer choices', async ({
  page,
}) => {
  const trip = consultationTrip();
  const fixture = await mockConsultation(page, trip);
  await page.goto('/trips');
  const card = page.getByRole('article');
  await expect(card).toContainText('Length to discuss');
  await expect(card).toContainText('Party to discuss');
  await expect(card).toContainText('Dates to discuss');
  await expect(card).not.toContainText('2 travelers');
  await expect(card).not.toContainText('5 days');
  expect(fixture.unexpected).toEqual([]);
});

test('a family trip never turns children into adult hotel search guests', async ({ page }) => {
  const trip = consultationTrip();
  trip.travelers = 3;
  trip.brief!.consultation!.party = {
    hasChildren: true,
    childAges: [7],
    source: 'message',
    evidence: 'Two adults and a seven-year-old',
  };
  trip.itinerary = [
    { day: 1, destinationId: 'london', title: 'A family day in London', items: [] },
  ];
  const fixture = await mockConsultation(page, trip);
  await page.goto(`/chat/${tripId}`);
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  await expect(
    page.getByText(
      'Family room pricing isn’t supported yet; your itinerary can still include children.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Guests', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check hotel rates', exact: true })).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test('explicitly clearing a service preference is recorded as a form decision, without clearing the other service', async ({
  page,
}) => {
  const trip = consultationTrip();
  trip.brief!.includeFlights = true;
  trip.brief!.consultation!.services.flights = {
    status: 'requested',
    source: 'message',
    evidence: 'Find flights for me',
  };
  trip.brief!.consultation!.services.hotels = {
    status: 'already_booked',
    source: 'message',
    evidence: 'My hotels are already booked',
  };
  const fixture = await mockConsultation(page, trip);
  await page.goto(`/chat/${tripId}`);
  await page.getByRole('button', { name: 'Edit trip details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make it your kind of trip' });
  await choose(
    page,
    dialog.getByRole('combobox', { name: 'Flights', exact: true }),
    'Not discussed',
  );
  await dialog.getByRole('button', { name: 'Save trip details' }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.patches[0]).toMatchObject({
    brief: {
      includeFlights: false,
      consultation: {
        services: {
          flights: { status: 'unknown', source: 'form' },
          hotels: { status: 'already_booked', source: 'message' },
        },
      },
    },
  });
  expect(fixture.unexpected).toEqual([]);
});

test('detailed research is outside concise chat and AUD targets remain separate from USD estimates', async ({
  page,
}) => {
  const trip = consultationTrip();
  trip.brief!.consultation!.facts.budget = {
    source: 'message',
    evidence: 'AUD 12000',
    valueState: 'specified',
  };
  trip.budget = 12000;
  trip.planning!.budget = { ...trip.planning!.budget, target: 12000, activities: 400, total: 400 };
  trip.planning!.questions = [];
  trip.itinerary = [
    { day: 1, destinationId: 'london', title: 'A quiet London morning', items: [] },
  ];
  trip.planning!.researchSummary =
    'The official [London guide](https://example.org/london) supports this route. Detailed opening and accessibility checks belong here.';
  const detail =
    'Allow extra time at each stop and confirm step-free entrances directly with the venue before travelling. ';
  trip.messages[1].content = `London has plenty of quiet corners. I’ve kept your mornings unhurried.\n\n${detail.repeat(9)}\n\nRead the [official access guide](https://example.org/access).`;
  const fixture = await mockConsultation(page, trip);
  await page.goto(`/chat/${tripId}`);
  await expect(
    page.getByText('London has plenty of quiet corners. I’ve kept your mornings unhurried.', {
      exact: true,
    }),
  ).toBeVisible();
  const disclosure = page
    .locator('details')
    .filter({ has: page.getByText('Read the full response', { exact: true }) });
  await expect(disclosure).toBeVisible();
  // The collapsed link is real markup, just outside the accessibility tree until it opens.
  const collapsedLink = disclosure.getByRole('link', {
    name: 'official access guide',
    includeHidden: true,
  });
  await expect(collapsedLink).toBeAttached();
  await expect(collapsedLink).not.toBeVisible();
  await page.getByText('Read the full response', { exact: true }).click();
  await expect(disclosure.getByRole('link', { name: 'official access guide' })).toHaveAttribute(
    'href',
    'https://example.org/access',
  );
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  await expect(
    page.getByTestId('research-summary').getByRole('link', { name: 'London guide' }),
  ).toHaveAttribute('href', 'https://example.org/london');
  const budget = page.getByTestId('budget-breakdown');
  await expect(budget).toBeVisible();
  await expect(budgetRow(page, 'Accommodation')).toHaveText('Not discussed');
  await expect(budgetRow(page, 'Flights')).toHaveText('Not discussed');
  await expect(budget).toContainText('$400 USD');
  await expect(budget).toContainText('A$12,000 AUD');
  await expect(budget).toContainText('No exchange-rate conversion has been applied');
  await expect(budget).not.toContainText('$400 /');
  expect(fixture.unexpected).toEqual([]);
});

test('service budget rows distinguish missing quotes, separate arrangements and excluded scope', async ({
  page,
}) => {
  const trip = consultationTrip();
  trip.itinerary = [
    { day: 1, destinationId: 'london', title: 'A quiet London morning', items: [] },
  ];
  trip.planning!.questions = [];
  trip.brief!.consultation!.services.hotels = {
    status: 'requested',
    source: 'message',
    evidence: 'Find hotels for me',
  };
  trip.brief!.consultation!.services.flights = {
    status: 'already_booked',
    source: 'message',
    evidence: 'My flights are already booked',
  };
  const fixture = await mockConsultation(page, trip);
  await page.goto(`/chat/${tripId}`);
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  const budget = page.getByTestId('budget-breakdown');
  await expect(budget).toBeVisible();
  const accommodation = budgetRow(page, 'Accommodation');
  const flights = budgetRow(page, 'Flights');
  await expect(accommodation).toHaveText('Not priced');
  await expect(flights).toHaveText('Arranged separately');
  await expect(accommodation).not.toContainText('$0');
  trip.brief!.consultation!.services.hotels = {
    status: 'not_needed',
    source: 'message',
    evidence: 'No hotels needed',
  };
  trip.brief!.consultation!.services.flights = {
    status: 'requested',
    source: 'message',
    evidence: 'Find flights for me',
  };
  trip.planning!.budget.flights = 650;
  await page.reload();
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  await expect(accommodation).toHaveText('Not in scope');
  await expect(flights).toHaveText('$650');
  expect(fixture.unexpected).toEqual([]);
});
