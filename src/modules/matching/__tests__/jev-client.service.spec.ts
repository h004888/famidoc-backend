import { DoctorClinicalTier } from '@prisma/client';
import { JevClientService } from '../services/jev-client.service';
import { sanitizeMatchingText } from '../utils/pii-sanitizer.util';

describe('sanitizeMatchingText & JevClientService (Tasks 4.1 & 4.3)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TYPESAFE_API_URL;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_JEV_MODEL;
    delete process.env.TYPESAFE_JEV_QUESTION_TYPE;
    delete process.env.TYPESAFE_JEV_ENABLED;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  const sampleCandidates = [
    {
      id: 'doc-1',
      clinicalTier: DoctorClinicalTier.STANDARD,
      specialty: 'Nhi - Y học gia đình',
      academicTitle: 'ThS.BS',
      experienceYears: 7,
      bio: 'Chăm sóc nhi khoa và y học gia đình toàn diện.',
      treatedCases: ['Viêm phế quản tái phát ở trẻ nhỏ'],
      facilityAddress: 'Quận 3, TP.HCM',
      ratingAvg: 4.9,
    },
    {
      id: 'doc-2',
      clinicalTier: DoctorClinicalTier.JUNIOR,
      specialty: 'Nội',
      academicTitle: 'BS',
      experienceYears: 2,
      bio: null,
      treatedCases: [],
      facilityAddress: 'Quận 7, TP.HCM',
      ratingAvg: 4.5,
    },
  ];

  it('strips phone numbers, emails, citizen IDs, and house numbers from text', () => {
    const raw =
      'Nhà số 123/4A đường Lê Lợi, liên hệ SĐT 0912345678 hoặc +84987654321, email test@example.com, CCCD 079090001234.';
    const sanitized = sanitizeMatchingText(raw);

    expect(sanitized).not.toContain('0912345678');
    expect(sanitized).not.toContain('84987654321');
    expect(sanitized).not.toContain('test@example.com');
    expect(sanitized).not.toContain('079090001234');
    expect(sanitized).not.toContain('123/4A');
  });

  it('returns JEV_UNAVAILABLE when TYPESAFE_API_KEY is missing on TypeSafe Cloud URL', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const client = new JevClientService();
    const res = await client.scoreCandidates({
      packageName: 'Đồng hành',
      durationMonths: 3,
      periodicVisitsQuota: 3,
      telehealthQuota: 20,
      memberCount: 4,
      ageGroups: ['Người cao tuổi'],
      careCategories: ['Tim mạch'],
      sanitizedDescription: 'Theo dõi huyết áp',
      candidates: [sampleCandidates[0]],
    });

    expect(res.ok).toBe(false);
    expect(res.errorReason).toBe('JEV_UNAVAILABLE');
  });

  it('calls POST https://api.typesafe.ai/v1/systemone and parses legacy array scores', async () => {
    process.env.TYPESAFE_API_KEY = 'ts_test_key';
    process.env.TYPESAFE_JEV_MODEL = 'jev-1.14.0';

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.14.0',
        answers: [
          { id: 'doc-1', score: 0.85, rationale: 'Chuyên môn phù hợp cao' },
          { id: 'doc-2', score: 0.52 },
        ],
      }),
    } as any);

    const client = new JevClientService();
    const res = await client.scoreCandidates({
      packageName: 'Đồng hành',
      durationMonths: 3,
      periodicVisitsQuota: 3,
      telehealthQuota: 20,
      memberCount: 4,
      ageGroups: ['Trẻ nhỏ'],
      careCategories: ['Nhi khoa'],
      sanitizedDescription: 'Khám định kỳ',
      candidates: sampleCandidates,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/systemone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ts_test_key',
        }),
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.scores).toHaveLength(2);
    expect(res.scores[0]).toMatchObject({
      doctorId: 'doc-1',
      fitScore: 0.85,
      rationale: 'Chuyên môn phù hợp cao',
    });
  });

  it('supports local Ollama /v1/systemone without API key using string state, object-map questions, and legend normalization', async () => {
    process.env.TYPESAFE_API_URL = 'http://localhost:11434/v1/systemone';
    process.env.TYPESAFE_JEV_MODEL = 'd3:4b';

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'd3:4b',
        answers: {
          'doc-1': {
            type: 'score',
            score: 3.9646,
            legend: {
              '0': 'Không phù hợp',
              '1': 'Ít phù hợp',
              '2': 'Trung bình',
              '3': 'Khá phù hợp',
              '4': 'Rất phù hợp',
            },
            confidence: 0.91,
          },
          'doc-2': {
            type: 'score',
            score: 0.32,
            legend: {
              '0': 'Không phù hợp',
              '1': 'Ít phù hợp',
              '2': 'Trung bình',
              '3': 'Khá phù hợp',
              '4': 'Rất phù hợp',
            },
            confidence: 0.88,
          },
        },
        usage: { input_tokens: 420, output_tokens: 0 },
      }),
    } as any);

    const client = new JevClientService();
    const res = await client.scoreCandidates({
      packageName: 'Đồng hành',
      durationMonths: 3,
      periodicVisitsQuota: 3,
      telehealthQuota: 20,
      memberCount: 4,
      ageGroups: ['Trẻ nhỏ'],
      careCategories: ['Nhi khoa'],
      districtArea: 'Quận 3',
      sanitizedDescription: 'Theo dõi hô hấp cho bé',
      candidates: sampleCandidates,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://localhost:11434/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();

    const parsedBody = JSON.parse(init.body as string);
    expect(typeof parsedBody.state).toBe('string');
    expect(parsedBody.state).toContain('Đồng hành');
    expect(parsedBody.state).toContain('doc-1');
    expect(parsedBody.questions['doc-1']).toMatchObject({
      type: 'score',
    });
    expect(Array.isArray(parsedBody.questions['doc-1'].criteria)).toBe(true);
    expect(parsedBody.questions['doc-1'].criteria).toHaveLength(5);

    expect(res.ok).toBe(true);
    expect(res.modelVersion).toBe('d3:4b');
    expect(res.scores[0].doctorId).toBe('doc-1');
    expect(res.scores[0].fitScore).toBeCloseTo(3.9646 / 4, 4);
    expect(res.scores[1].fitScore).toBeCloseTo(0.32 / 4, 4);
  });

  it('supports noul questionType and parses answers[id].noul directly', async () => {
    process.env.TYPESAFE_API_URL = 'http://localhost:11434/v1/systemone';
    process.env.TYPESAFE_JEV_MODEL = 'd3:4b';
    process.env.TYPESAFE_JEV_QUESTION_TYPE = 'noul';

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'd3:4b',
        answers: {
          'doc-1': { type: 'noul', noul: 0.9995 },
          'doc-2': { type: 'noul', noul: 0.0001 },
        },
      }),
    } as any);

    const client = new JevClientService();
    const res = await client.scoreCandidates({
      packageName: 'Đồng hành',
      durationMonths: 3,
      periodicVisitsQuota: 3,
      telehealthQuota: 20,
      memberCount: 4,
      ageGroups: ['Trẻ nhỏ'],
      careCategories: ['Nhi khoa'],
      sanitizedDescription: 'Khám định kỳ',
      candidates: sampleCandidates,
    });

    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(parsedBody.questions['doc-1'].type).toBe('noul');
    expect(parsedBody.questions['doc-1'].criteria).toHaveProperty('true');
    expect(parsedBody.questions['doc-1'].criteria).toHaveProperty('false');

    expect(res.ok).toBe(true);
    expect(res.scores[0].fitScore).toBeCloseTo(0.9995, 4);
    expect(res.scores[1].fitScore).toBeCloseTo(0.0001, 4);
  });
});
