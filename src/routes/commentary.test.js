import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const selectMock = mock.fn();
const insertMock = mock.fn();

mock.module('../db/db.js', {
  namedExports: {
    db: {
      select: (...args) => selectMock(...args),
      insert: (...args) => insertMock(...args),
    },
  },
});

const { listCommentary, createCommentary } = await import(
  '../routes/commentary.js'
);

/**
 * Build a chainable Drizzle-like select mock that resolves to rows.
 * @param {unknown[]} rows - Rows returned by limit().
 */
function mockSelectChain(rows) {
  const chain = {
    from: mock.fn(() => chain),
    where: mock.fn(() => chain),
    orderBy: mock.fn(() => chain),
    limit: mock.fn(async () => rows),
  };
  selectMock.mock.resetCalls();
  selectMock.mock.mockImplementation(() => chain);
  return chain;
}

/**
 * Build a chainable Drizzle-like insert mock that resolves to rows.
 * @param {unknown[]} rows - Rows returned by returning().
 */
function mockInsertChain(rows) {
  const chain = {
    values: mock.fn(() => chain),
    returning: mock.fn(async () => rows),
  };
  insertMock.mock.resetCalls();
  insertMock.mock.mockImplementation(() => chain);
  return chain;
}

/**
 * Minimal Express-like response double.
 * @param {{ broadcastCommentary?: Function }} [locals]
 */
function createRes(locals = {}) {
  return {
    statusCode: 200,
    body: undefined,
    app: { locals },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

beforeEach(() => {
  selectMock.mock.resetCalls();
  insertMock.mock.resetCalls();
});

describe('listCommentary', () => {
  it('returns commentary for a match', async () => {
    const rows = [{ id: 1, matchId: 7, message: 'Goal!' }];
    mockSelectChain(rows);

    const res = createRes();
    await listCommentary({ params: { id: '7' }, query: { limit: '10' } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { data: rows });
  });

  it('rejects invalid match id', async () => {
    const res = createRes();
    await listCommentary({ params: { id: 'abc' }, query: {} }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid match id.');
    assert.equal(selectMock.mock.callCount(), 0);
  });

  it('rejects invalid query', async () => {
    const res = createRes();
    await listCommentary({ params: { id: '1' }, query: { limit: '0' } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid query.');
    assert.equal(selectMock.mock.callCount(), 0);
  });

  it('returns 500 when the database fails', async () => {
    const chain = {
      from: mock.fn(() => chain),
      where: mock.fn(() => chain),
      orderBy: mock.fn(() => chain),
      limit: mock.fn(async () => {
        throw new Error('db down');
      }),
    };
    selectMock.mock.mockImplementation(() => chain);

    const errorSpy = mock.method(console, 'error', () => {});
    const res = createRes();
    await listCommentary({ params: { id: '1' }, query: {} }, res);
    errorSpy.mock.restore();

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Failed to list commentary.' });
  });
});

describe('createCommentary', () => {
  it('creates commentary and broadcasts the event', async () => {
    const event = {
      id: 9,
      matchId: 3,
      message: 'What a save!',
      minute: 44,
    };
    mockSelectChain([{ id: 3 }]);
    mockInsertChain([event]);
    const broadcastCommentary = mock.fn();

    const res = createRes({ broadcastCommentary });
    await createCommentary(
      {
        params: { id: '3' },
        body: { message: 'What a save!', minute: 44 },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { data: event });
    assert.equal(broadcastCommentary.mock.callCount(), 1);
    assert.deepEqual(broadcastCommentary.mock.calls[0].arguments, [
      event.matchId,
      event,
    ]);
  });

  it('rejects invalid match id', async () => {
    const res = createRes();
    await createCommentary(
      { params: { id: '-1' }, body: { message: 'ok' } },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid match id.');
    assert.equal(insertMock.mock.callCount(), 0);
  });

  it('rejects invalid payload', async () => {
    const res = createRes();
    await createCommentary({ params: { id: '1' }, body: {} }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid payload.');
    assert.equal(insertMock.mock.callCount(), 0);
  });

  it('returns 404 when the match does not exist', async () => {
    mockSelectChain([]);

    const res = createRes();
    await createCommentary(
      { params: { id: '99' }, body: { message: 'ok' } },
      res,
    );

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Match not found.' });
    assert.equal(insertMock.mock.callCount(), 0);
  });

  it('returns 500 when the database fails', async () => {
    mockSelectChain([{ id: 1 }]);
    const chain = {
      values: mock.fn(() => chain),
      returning: mock.fn(async () => {
        throw new Error('db down');
      }),
    };
    insertMock.mock.mockImplementation(() => chain);

    const errorSpy = mock.method(console, 'error', () => {});
    const res = createRes();
    await createCommentary(
      { params: { id: '1' }, body: { message: 'ok' } },
      res,
    );
    errorSpy.mock.restore();

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Failed to create commentary.' });
  });
});
