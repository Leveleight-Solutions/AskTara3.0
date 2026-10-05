import {
  openStudioClientDesk,
  openStudioClientProfiles,
  openStudioDestinationResearch,
} from './ui-helpers';
import { test, expect } from '@playwright/test';
import type { StudioWorkspace } from '../shared/studio';
import type { StudioClientProfile } from '../shared/studio-clients';
import type { StudioDestinationResearch } from '../shared/studio-travel-research';

const photo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6N3VEAAAAASUVORK5CYII=';

// Profile creation, edits, linking, history aggregation and reloads use the real local API.
// Research alone is mocked; backend tests separately inspect the actual model payload.
test('a returning profile preserves private details and structured trip feedback across editing and the next itinerary', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspaceIds: string[] = [];
  let profileId = '';
  const researchRequests: {
    workspaceId: string;
    clientId: string;
    body: Record<string, unknown>;
  }[] = [];
  await page.route('**/api/integrations', (route) =>
    route.fulfill({
      json: {
        ai: true,
        hotels: false,
        flights: false,
        activities: false,
        mode: 'live',
      },
    }),
  );
  await page.route(/\/api\/studio\/workspaces\/[^/]+\/destinations\/research$/, async (route) => {
    const workspaceId = new URL(route.request().url()).pathname.split('/')[4];
    const stored = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    expect(stored.status()).toBe(200);
    const workspace = (await stored.json()).workspace as StudioWorkspace;
    researchRequests.push({
      workspaceId,
      clientId: workspace.brief.clientId || '',
      body: route.request().postDataJSON(),
    });
    const now = new Date().toISOString();
    const research: StudioDestinationResearch = {
      checkedAt: now,
      inputKey: 'fictional-profile-browser-test',
      historyUsed: true,
      candidates: [
        {
          destination: 'Tokyo',
          country: 'Japan',
          countryCode: 'JP',
          reason: 'Consider quiet gardens and galleries, reflecting the recorded feedback.',
          suggestedDays: 6,
          thingsToDo: ['Explore gardens'],
          conditions: 'Review current notices.',
          seasonalGuidance: 'Confirm conditions for the chosen travel dates.',
          status: 'checked',
          advisory: 'Official advice checked for this test.',
          recommendable: true,
          sources: [
            {
              label: 'Official travel advice',
              url: 'https://www.gov.uk/foreign-travel-advice/japan',
              checkedAt: now,
              kind: 'advisory',
              publishedAt: now,
            },
          ],
        },
      ],
      notes: [],
    };
    workspace.destinationResearch = research;
    await route.fulfill({ json: { workspace, research } });
  });
  const createWorkspace = async () => {
    const response = await page.request.post('/api/studio/workspaces', { data: {} });
    expect(response.status()).toBe(201);
    const workspace = (await response.json()).workspace as StudioWorkspace;
    workspaceIds.push(workspace.id);
    return workspace;
  };
  try {
    const first = await createWorkspace();
    await page.goto(`/studio/${first.id}`);
    await openStudioClientDesk(page);
    await openStudioClientProfiles(page, 'Client profiles · new or returning');
    await page.getByRole('button', { name: 'New client profile', exact: true }).click();
    const form = page.getByRole('form', { name: 'Client profile', exact: true });
    await form
      .getByRole('textbox', { name: 'Profile name', exact: true })
      .fill('Fictional Profile Traveller');
    await form.getByLabel('Profile country of residence', { exact: true }).selectOption('AU');
    await form.getByLabel('Profile nationality', { exact: true }).selectOption('CA');
    await form.getByLabel('Profile passport nationality', { exact: true }).selectOption('NZ');
    await form.getByLabel('Profile date of birth', { exact: true }).fill('1988-07-12');
    await form
      .getByRole('textbox', { name: 'Interests · comma separated', exact: true })
      .fill('gardens, galleries');
    for (const [index, destination, country, date, feedback, notes] of [
      [1, 'Kyoto', 'JP', '2024-05-12', 'liked', 'Liked quiet gardens and museums.'],
      [2, 'Dubai', 'AE', '2025-06-10', 'disliked', 'Disliked summer heat and busy nightlife.'],
    ] as const) {
      await form.getByRole('button', { name: 'Add past trip', exact: true }).click();
      await form.getByLabel(`Past trip ${index} destination`, { exact: true }).fill(destination);
      await form.getByLabel(`Past trip ${index} country`, { exact: true }).selectOption(country);
      await expect(form.getByLabel(`Past trip ${index} status`, { exact: true })).toHaveValue(
        'visited',
      );
      await form.getByLabel(`Past trip ${index} date`, { exact: true }).fill(date);
      await form
        .getByLabel(`Past trip ${index} interests`, { exact: true })
        .fill(index === 1 ? 'gardens, culture' : 'beaches');
      await form.getByLabel(`Past trip ${index} feedback`, { exact: true }).selectOption(feedback);
      await form.getByLabel(`Past trip ${index} notes`, { exact: true }).fill(notes);
    }
    await form.getByRole('button', { name: 'Add past trip', exact: true }).click();
    await form.getByRole('button', { name: 'Remove past trip 3', exact: true }).click();
    await form.getByLabel('Client photo', { exact: true }).setInputFiles({
      name: 'synthetic-profile.png',
      mimeType: 'image/png',
      buffer: Buffer.from(photo.split(',')[1], 'base64'),
    });
    await expect(
      form.getByRole('img', { name: 'Client photo preview', exact: true }),
    ).toBeVisible();
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/studio/client-profiles' &&
        response.request().method() === 'POST',
    );
    await form.getByRole('button', { name: 'Save client profile', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const profile = (await createdResponse.json()).client as StudioClientProfile;
    profileId = profile.id;
    expect(profile).toMatchObject({
      country: 'AU',
      nationality: 'CA',
      passportNationality: 'NZ',
      dateOfBirth: '1988-07-12',
      photoDataUrl: photo,
      history: [
        {
          destination: 'Kyoto',
          country: 'JP',
          visitedAt: '2024-05-12',
          experience: 'visited',
          feedback: 'liked',
          interests: ['gardens', 'culture'],
          notes: 'Liked quiet gardens and museums.',
        },
        {
          destination: 'Dubai',
          country: 'AE',
          visitedAt: '2025-06-10',
          experience: 'visited',
          feedback: 'disliked',
          notes: 'Disliked summer heat and busy nightlife.',
        },
      ],
    });
    await expect(page.getByRole('tab', { name: 'Route', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await openStudioClientDesk(page);
    await openStudioClientProfiles(page, 'Client profiles · Fictional Profile Traveller');
    await expect(page.getByLabel('Saved client', { exact: true })).toHaveValue(profileId);
    await expect(form).not.toBeVisible();
    await expect.poll(() => researchRequests.length).toBe(1);
    const currentTrip = (
      await (await page.request.get(`/api/studio/workspaces/${first.id}`)).json()
    ).workspace as StudioWorkspace;
    const tripPreferences = {
      context: 'This particular trip is for business meetings and architecture visits.',
      passportNationality: 'AU',
      interests: ['architecture'],
      foodPreferences: ['vegan'],
    };
    expect(
      (
        await page.request.patch(`/api/studio/workspaces/${first.id}`, {
          data: { revision: currentTrip.revision, brief: tripPreferences },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await openStudioClientDesk(page);
    await openStudioClientProfiles(page, 'Client profiles · Fictional Profile Traveller');
    await expect(
      page.getByRole('img', { name: 'Fictional Profile Traveller profile', exact: true }),
    ).toHaveAttribute('src', photo);
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
    await expect(form.getByLabel('Profile country of residence', { exact: true })).toHaveValue(
      'AU',
    );
    await expect(form.getByLabel('Profile nationality', { exact: true })).toHaveValue('CA');
    await expect(form.getByLabel('Profile passport nationality', { exact: true })).toHaveValue(
      'NZ',
    );
    await expect(form.getByLabel('Profile date of birth', { exact: true })).toHaveValue(
      '1988-07-12',
    );
    await expect(form.getByLabel('Past trip 2 feedback', { exact: true })).toHaveValue('disliked');
    await form.getByLabel('Profile country of residence', { exact: true }).selectOption('US');
    await form.getByLabel('Profile date of birth', { exact: true }).fill('1988-07-13');
    await form
      .getByLabel('Past trip 1 notes', { exact: true })
      .fill('Liked quiet gardens; prefers smaller galleries.');
    await form.getByRole('button', { name: 'Save client profile', exact: true }).click();
    await expect(form).not.toBeVisible();
    await expect.poll(() => researchRequests.length).toBe(2);
    const afterProfileEdit = (
      await (await page.request.get(`/api/studio/workspaces/${first.id}`)).json()
    ).workspace as StudioWorkspace;
    expect(afterProfileEdit.brief).toMatchObject(tripPreferences);

    const past = await createWorkspace();
    const previousPlan = await page.request.patch(`/api/studio/workspaces/${past.id}`, {
      data: {
        revision: past.revision,
        brief: {
          clientId: profileId,
          startDate: '2025-04-01',
          endDate: '2025-04-04',
          interests: ['architecture'],
        },
        stops: [
          {
            id: 'fictional-previous-plan',
            name: 'Lisbon',
            country: 'Portugal',
            nights: 3,
            arrivalDate: '2025-04-01',
            arrivalFixed: true,
            departureDate: '2025-04-04',
            onwardTransport: 'undecided',
            neighbourhood: '',
            notes: '',
          },
        ],
      },
    });
    expect(previousPlan.status()).toBe(200);
    const next = await createWorkspace();
    await page.goto(`/studio/${next.id}`);
    await openStudioClientDesk(page);
    await openStudioClientProfiles(page, 'Client profiles · new or returning');
    await page.getByLabel('Saved client', { exact: true }).selectOption(profileId);
    await expect.poll(() => researchRequests.length).toBe(3);
    await expect(page.getByRole('tab', { name: 'Route', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await openStudioClientDesk(page);
    await openStudioClientProfiles(page, 'Client profiles · Fictional Profile Traveller');
    await expect(page.getByText('View travel history (3)', { exact: true })).toBeVisible();
    await page.getByText('View travel history (3)', { exact: true }).click();
    const history = page.getByRole('region', { name: 'Saved travel history', exact: true });
    await expect(history).toContainText('Kyoto');
    await expect(history).toContainText('Liked quiet gardens; prefers smaller galleries.');
    await expect(history).toContainText('Disliked');
    await expect(history).toContainText('Lisbon');
    await expect(history).toContainText('Planned itinerary');
    await expect(history).toContainText('Visited');
    await openStudioDestinationResearch(page);
    await expect(page.getByText('Based on previous travel', { exact: false })).toBeVisible();
    const linked = (await (await page.request.get(`/api/studio/workspaces/${next.id}`)).json())
      .workspace as StudioWorkspace;
    expect(linked.brief.clientId).toBe(profileId);
    expect(linked.brief.passportNationality).toBe('NZ');
    expect(linked.brief.interests).toEqual(['gardens', 'galleries']);
    expect(linked.brief.origin).toBe('');
    const profiles = (await (await page.request.get('/api/studio/client-profiles')).json())
      .clients as StudioClientProfile[];
    const saved = profiles.find((client) => client.id === profileId)!;
    expect(saved).toMatchObject({
      country: 'US',
      nationality: 'CA',
      dateOfBirth: '1988-07-13',
      photoDataUrl: photo,
    });
    expect(saved.history).toHaveLength(2);
    expect(researchRequests.at(-1)?.clientId).toBe(profileId);
    const researchBodies = JSON.stringify(researchRequests.map(({ body }) => body));
    expect(researchBodies).not.toMatch(
      /photoDataUrl|dateOfBirth|Fictional Profile Traveller|1988-07/,
    );
    await page.reload();
    await openStudioClientDesk(page);
    await openStudioClientProfiles(page, 'Client profiles · Fictional Profile Traveller');
    await expect(page.getByText('View travel history (3)', { exact: true })).toBeVisible();
  } finally {
    for (const id of workspaceIds)
      expect((await page.request.delete(`/api/studio/workspaces/${id}`)).status()).toBe(204);
    if (profileId)
      expect((await page.request.delete(`/api/studio/client-profiles/${profileId}`)).status()).toBe(
        204,
      );
  }
});
