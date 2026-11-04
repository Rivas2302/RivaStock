import { expect, test, type Page, type Route } from '@playwright/test';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '20000000-0000-4000-8000-000000000001';
const PROJECT_URL = 'https://rivastock-test.invalid';
const PHOTO_URL = `${PROJECT_URL}/storage/v1/object/public/assets/${OWNER_ID}/products/${PRODUCT_ID}/front.webp`;
const now = new Date().toISOString();

type Modules = { ai: boolean; knowledge: boolean; automation: boolean };

function fixtureSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: OWNER_ID, email: 'mobile-ai@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: OWNER_ID,
    provider: 'codex',
    task_type: 'text_generation',
    input: 'Prepará una respuesta para un proveedor.',
    output: null,
    error: null,
    status: 'completed',
    include_business_context: false,
    include_project_context: false,
    model_id: 'gpt-6-luna',
    reasoning_effort: 'low',
    created_at: now,
    started_at: now,
    completed_at: now,
    attempt_count: 1,
    ...overrides,
  };
}

function chat(id: string, title: string, preview: string, provider: 'codex' | 'mock' = 'codex') {
  return {
    id,
    provider,
    title,
    model_id: provider === 'codex' ? 'gpt-6-luna' : null,
    reasoning_effort: provider === 'codex' ? 'low' : null,
    created_at: now,
    updated_at: now,
    last_message_at: now,
    last_message_preview: preview,
    has_pending_job: false,
  };
}

async function mockRiva(page: Page, modules: Modules = { ai: true, knowledge: true, automation: true }, empty = false) {
  const chats = empty ? [] : [
    chat('chat-cameras', '[QA] Stock de cámaras', '¿Cuántas cámaras quedan?'),
    chat('chat-chargers', '[QA] Reposición', 'Consultas sobre cargadores.'),
  ];
  const jobs = empty ? [] : [
    task('task-text', { input: 'Prepará una respuesta breve para el proveedor.', output: 'La respuesta está preparada.' }),
    task('task-failed', {
      task_type: 'fb_copywriting',
      input: JSON.stringify({ product: { name: 'Cable USB C', category: 'Cargadores', price: 1200 }, condition: 'new' }),
      output: null,
      error: 'La PC se desconectó antes de responder.',
      status: 'failed',
      completed_at: null,
      attempt_count: 1,
    }),
    task('task-pending', { input: 'Revisar el pedido actual.', output: null, status: 'pending', completed_at: null }),
  ];
  const calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  const chatMessages = new Map<string, { chat: ReturnType<typeof chat>; messages: Array<Record<string, unknown>>; jobs: Array<Record<string, unknown>> }>();
  const readChatDetail = (id: string) => chatMessages.get(id) ?? {
    chat: chats.find((item) => item.id === id) ?? chat(id, '[QA] Chat', 'Pregunta de prueba.'),
    messages: [{ id: `${id}-message`, job_id: `${id}-job`, role: 'user', content: '¿Cuántas cámaras quedan?', created_at: now }],
    jobs: [],
  };

  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'rivastock-test.invalid') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });

    const path = url.pathname;
    const method = route.request().method();
    const body = method === 'POST' ? (route.request().postDataJSON() as Record<string, unknown> | null) ?? {} : {};
    if (path === '/functions/v1/ai-bridge' && method === 'POST') {
      const action = String(body.action ?? '');
      calls.push({ action, body });
      if (action === 'status') return route.fulfill({ json: { state: 'idle', paired: true, legacy: false, last_seen_at: now, device: { id: 'device', name: 'PC de prueba' }, codex_configured: true } });
      if (action === 'recent') {
        const older = Boolean(body.before);
        return route.fulfill({ json: {
          jobs: older ? [task('task-older', { input: 'Consultar el pedido de la semana anterior.' })] : jobs,
          knowledge_organize_jobs: [],
          finished_task_count: jobs.filter((item) => item.status === 'completed' || item.status === 'failed').length,
          counts: { all: empty ? 0 : 12 + Math.max(jobs.length - 3, 0), in_progress: empty ? 0 : 1, failed: empty ? 0 : 1, knowledge_review: 0 },
          has_more: !older && !empty,
          next_before: older || empty ? null : { created_at: now, id: 'task-text' },
        } });
      }
      if (action === 'chat_list') return route.fulfill({ json: {
        chats,
        total_count: chats.length,
        older_than_30_days_count: 0,
        recent_cutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        has_more: false,
        next_offset: chats.length,
      } });
      if (action === 'chat_get') return route.fulfill({ json: readChatDetail(String(body.chat_id)) });
      if (action === 'chat_send') {
        const chatId = 'chat-new';
        const jobId = 'job-chat-new';
        const created = chat(chatId, String(body.input).slice(0, 80), String(body.input), body.provider === 'mock' ? 'mock' : 'codex');
        const completedJob = task(jobId, {
          task_type: 'text_generation',
          provider: body.provider,
          input: body.input,
          output: '[QA] Respuesta simulada desde la conversación.',
          status: 'completed',
          model_id: body.provider === 'mock' ? null : body.model_id,
          reasoning_effort: body.provider === 'mock' ? null : body.reasoning_effort,
          chat_id: chatId,
        });
        const messages = [
          { id: `${jobId}-user`, job_id: jobId, role: 'user', content: body.input, created_at: now },
          { id: `${jobId}-assistant`, job_id: jobId, role: 'assistant', content: completedJob.output, created_at: now },
        ];
        chats.unshift(created);
        chatMessages.set(chatId, { chat: created, messages, jobs: [completedJob] });
        return route.fulfill({ json: { chat_id: chatId, job: completedJob } });
      }
      if (action === 'chat_delete') {
        const index = chats.findIndex((item) => item.id === body.chat_id);
        if (index >= 0) chats.splice(index, 1);
        return route.fulfill({ json: { deleted: true } });
      }
      if (action === 'retry') {
        const retried = task('task-retried', { input: 'Reintentar la redacción de Cable USB C.', status: 'pending', output: null, completed_at: null, attempt_count: 0 });
        jobs.unshift(retried);
        return route.fulfill({ json: { job: retried } });
      }
      if (action === 'create') {
        const created = task('task-created', {
          provider: body.provider,
          input: body.input,
          status: 'pending',
          output: null,
          completed_at: null,
          model_id: body.model_id,
          reasoning_effort: body.reasoning_effort,
        });
        jobs.unshift(created);
        return route.fulfill({ json: { job: created } });
      }
      if (action === 'get') {
        const found = jobs.find((item) => item.id === body.job_id) ?? task(String(body.job_id), { status: 'pending', output: null, completed_at: null });
        return route.fulfill({ json: { job: found } });
      }
      if (action === 'task_delete' || action === 'tasks_delete_all') return route.fulfill({ json: { deleted_count: 1 } });
      return route.fulfill({ json: {} });
    }

    if (path === '/auth/v1/user') return route.fulfill({ json: fixtureSession().user });
    if (path.endsWith('/rpc/get_owner_profile')) return route.fulfill({ json: [{ id: OWNER_ID, role: 'admin', business_name: 'QA Negocio', business_name_lower: 'qa negocio', display_name: 'Dueño QA', currency_symbol: '$', dark_mode: false, onboarding_completed_at: now, created_at: now }] });
    if (path.endsWith('/rpc/is_platform_admin')) return route.fulfill({ json: false });
    if (path.endsWith('/rpc/my_business_plan')) return route.fulfill({ json: { plan_code: modules.automation ? 'pro' : 'base', plan_name: modules.automation ? 'RivaStock IA' : 'RivaStock', status: 'active', limits: { modules } } });
    if (path.endsWith('/rpc/get_public_catalog_products') || path.endsWith('/rpc/get_public_inventory_owner_labels')) return route.fulfill({ json: [] });
    if (path.endsWith('/rpc/')) return route.fulfill({ json: null });
    if (path === '/rest/v1/collaborators' || path === '/rest/v1/inventory_owner_memberships' || path === '/rest/v1/inventory_owners') return route.fulfill({ json: [] });
    if (path === '/rest/v1/inventory_operation_settings') return route.fulfill({ json: { holdings_enabled: false } });
    if (path === '/rest/v1/ai_function_settings' || path === '/rest/v1/knowledge_ai_proposals' || path === '/rest/v1/knowledge_documents'
      || path === '/rest/v1/ai_job_knowledge_sources' || path === '/rest/v1/ai_memory_events' || path === '/rest/v1/ai_memories') return route.fulfill({ json: [] });
    if (path === '/rest/v1/products') return route.fulfill({ json: [{
      id: PRODUCT_ID, user_id: OWNER_ID, name: '[QA] Cámara WiFi', category: 'Seguridad', description: 'Cámara de prueba',
      sale_price: 50000, purchase_price: 30000, stock: 2, min_stock: 0, image_url: PHOTO_URL, images: [PHOTO_URL],
      show_in_catalog: true, created_at: now, updated_at: now,
    }] });
    if (path.endsWith('/rpc/request_fb_copywriting')) {
      calls.push({ action: 'request_fb_copywriting', body });
      return route.fulfill({ json: 'task-copywriting' });
    }
    if (path.endsWith('/rpc/request_fb_photo_review')) {
      calls.push({ action: 'request_fb_photo_review', body });
      return route.fulfill({ json: 'task-photo-review' });
    }
    if (path === '/rest/v1/profiles') return route.fulfill({ json: [{ id: OWNER_ID, business_name: 'QA Negocio', onboarding_completed_at: now }] });
    if (path === '/storage/v1/object/public/assets/' || path.includes('/storage/v1/')) return route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('fixture') });
    return route.fulfill({ json: [] });
  });

  await page.addInitScript((session) => localStorage.setItem('rivastock-auth', JSON.stringify(session)), fixtureSession());
  return { calls, chats, jobs };
}

test('mobile chat: search, swipe-delete confirmation, browser back, settings and mock send', async ({ page }, testInfo) => {
  const { calls } = await mockRiva(page);
  await page.goto('/ia?view=chats');
  await expect(page.getByRole('heading', { name: '[QA] Stock de cámaras' })).toBeVisible();
  await page.getByLabel('Buscar en tus chats').fill('cargadores');
  await expect(page.getByRole('button', { name: /^\[QA\] Reposición\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^\[QA\] Stock de cámaras\./ })).toHaveCount(0);
  await page.getByLabel('Buscar en tus chats').fill('');

  const row = page.getByRole('button', { name: /^\[QA\] Reposición\./ });
  const bounds = await row.boundingBox();
  if (!bounds) throw new Error('La fila QA no tiene límites visibles.');
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0, clientX: bounds.x + bounds.width - 24, clientY: bounds.y + bounds.height / 2 });
  await row.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 1, button: 0, clientX: bounds.x + 30, clientY: bounds.y + bounds.height / 2 });
  await row.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, button: 0, clientX: bounds.x + 30, clientY: bounds.y + bounds.height / 2 });
  await expect(row).toHaveClass(/-translate-x-24/);
  await page.getByRole('button', { name: 'Eliminar [QA] Reposición' }).click();
  await page.getByRole('button', { name: 'Eliminar chat', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: '¿Eliminar este chat?' });
  await expect(deleteDialog).toContainText('Se borran los mensajes y sus fuentes.');
  await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: /^\[QA\] Stock de cámaras\./ }).click();
  await expect(page.getByLabel('Conversación de IA')).toBeVisible();
  await expect(page).toHaveURL(/chat=chat-cameras/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '[QA] Stock de cámaras' })).toBeVisible();

  await page.getByRole('button', { name: 'Nuevo chat' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo chat' })).toBeVisible();
  await page.getByRole('button', { name: /GPT-6 Luna.*Bajo/ }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes de este chat' });
  await settings.getByRole('button', { name: /GPT-6\.1 Sol/ }).click();
  await expect(page.getByRole('button', { name: /GPT-6\.1 Sol.*Bajo/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await page.getByLabel('Agente').selectOption('mock', { force: true });
  await page.getByLabel('Mensaje para la IA').fill('[QA] Contame el estado de la conexión.');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByText('[QA] Respuesta simulada desde la conversación.').first()).toBeVisible();
  expect(calls.find((call) => call.action === 'chat_send')?.body).toMatchObject({ provider: 'mock', input: '[QA] Contame el estado de la conexión.' });
  await expect(page).toHaveURL(/chat=chat-new/);
  await expect(page.getByRole('navigation', { name: 'Secciones de IA' })).toHaveCount(0);
  await testInfo.attach(`${testInfo.project.name}-mobile-chat`, { body: await page.screenshot(), contentType: 'image/png' });
});

test('mobile tasks: filters, pagination, detail, retry, new task and product task', async ({ page }, testInfo) => {
  const { calls } = await mockRiva(page);
  await page.goto('/ia?view=tasks');
  await expect(page.getByRole('button', { name: 'Todas · 12' })).toBeVisible();
  await page.getByRole('button', { name: 'Con error · 1' }).click();
  const retryButton = page.getByRole('button', { name: 'Reintentar: Publicación: Cable USB C' });
  await expect(retryButton).toBeVisible();
  await retryButton.click();
  await expect.poll(() => calls.filter((call) => call.action === 'retry')).toHaveLength(1);
  await page.getByRole('button', { name: /^Todas ·/ }).click();
  await page.getByRole('button', { name: 'Abrir tarea: Texto: Prepará una respuesta breve para el proveedor.' }).click();
  await expect(page.getByLabel('Detalle de tarea de IA')).toBeVisible();
  await expect(page.getByText('La respuesta está preparada.')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Ver 9 tareas anteriores' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver 9 tareas anteriores' }).click();
  await expect(page.getByText('Consultar el pedido de la semana anterior.')).toBeVisible();

  await page.getByRole('button', { name: 'Nueva tarea' }).click();
  await page.getByLabel('Contale qué necesitás').fill('[QA] Prepará una respuesta corta para un proveedor.');
  await page.getByRole('button', { name: 'Abrir ajustes del modelo y razonamiento' }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes de esta tarea' });
  await settings.getByRole('button', { name: /GPT-6\.1 Sol/ }).click();
  await settings.getByRole('button', { name: 'Listo' }).click();
  await page.getByRole('button', { name: 'Enviar a mi PC' }).click();
  await expect(page.getByLabel('Detalle de tarea de IA')).toBeVisible();
  expect(calls.find((call) => call.action === 'create')?.body).toMatchObject({ input: '[QA] Prepará una respuesta corta para un proveedor.', model_id: 'gpt-6.1-sol' });
  await page.goBack();
  await page.getByRole('button', { name: 'Cerrar nueva tarea' }).click();
  await page.getByRole('button', { name: 'Nueva tarea' }).click();
  await page.getByRole('radio', { name: /Publicación para Facebook/ }).click();
  await page.getByRole('button', { name: /\[QA\] Cámara WiFi/ }).click();
  await page.getByRole('button', { name: 'Enviar a mi PC' }).click();
  await expect.poll(() => calls.filter((call) => call.action === 'request_fb_copywriting')).toHaveLength(1);
  await expect(page).toHaveURL(/task=task-copywriting/);
  await expect(page.getByLabel('Detalle de tarea de IA')).toBeVisible();
  await testInfo.attach(`${testInfo.project.name}-mobile-tasks`, { body: await page.screenshot(), contentType: 'image/png' });
});

test('mobile chat and task lists show their empty states and next actions', async ({ page }) => {
  await mockRiva(page, undefined, true);
  await page.goto('/ia?view=chats');
  await expect(page.getByText('Todavía no tenés chats. Preguntale algo a tu IA.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo chat' })).toBeVisible();

  await page.goto('/ia?view=tasks');
  await expect(page.getByText('Todavía no hay tareas. Cuando envíes una, va a aparecer acá.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva tarea' })).toBeVisible();
});

test('desktop AI hub retains the existing Chats and Tasks workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop regression is checked in Chromium only.');
  await mockRiva(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/ia?view=chats');
  await expect(page.getByRole('navigation', { name: 'Secciones de IA' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '[QA] Stock de cámaras' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo chat' })).toBeVisible();
  await testInfo.attach('desktop-ai-chats-1280x900', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Tareas', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Secciones de IA' })).toBeVisible();
  await expect(page.getByLabel('Nueva tarea')).toBeVisible();
  await expect(page.locator('button').filter({ hasText: 'Nueva tarea' })).toHaveCount(0);
  await testInfo.attach('desktop-ai-tasks-1280x900', { body: await page.screenshot(), contentType: 'image/png' });
});
test('mobile new task only shows types enabled by the business modules', async ({ page }) => {
  await mockRiva(page, { ai: true, knowledge: false, automation: false });
  await page.goto('/ia?view=tasks&new=1');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Texto libre/ })).toBeVisible();
  await expect(page.getByText('Publicación para Facebook')).toHaveCount(0);
  await expect(page.getByText('Revisar fotos')).toHaveCount(0);
});
