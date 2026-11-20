import { AuthController } from '../controllers/auth.controller';

describe('AuthController - refresh & logout', () => {
  let controller: AuthController;
  let authService: any;

  beforeEach(() => {
    authService = {
      refresh: jest.fn(),
      logout: jest.fn(),
    };
    controller = new AuthController(authService);
  });

  it('refresh delegates to authService.refresh with ip and user-agent', async () => {
    authService.refresh.mockResolvedValue({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
    });

    const res = await (controller as any).refresh(
      { refreshToken: 'rt-1' },
      { ip: '1.2.3.4', headers: { 'user-agent': 'vitest' } },
    );

    expect(authService.refresh).toHaveBeenCalledWith(
      { refreshToken: 'rt-1' },
      '1.2.3.4',
      'vitest',
    );
    expect(res.accessToken).toBe('at-2');
  });

  it('logout passes optional refreshToken to authService.logout', async () => {
    authService.logout.mockResolvedValue({ success: true, message: 'ok' });

    await (controller as any).logout(
      { user: { id: 'u-1' }, headers: { authorization: 'Bearer at-1' } },
      { refreshToken: 'rt-1' },
    );

    expect(authService.logout).toHaveBeenCalledWith('u-1', 'Bearer at-1', 'rt-1');
  });
});
