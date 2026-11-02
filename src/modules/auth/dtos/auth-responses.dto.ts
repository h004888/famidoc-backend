export interface RegisterInitiateResponse {
  message: string;
  email: string;
  expiresInSeconds: number;
}

export interface LoginSuccessResponse {
  accessToken: string;
  role: string;
  user: {
    id: string;
    email: string;
    phone?: string | null;
    fullName: string;
    role: string;
    status: string;
    avatarUrl?: string | null;
  };
}

export interface ApiResponseMessage {
  message: string;
  success: boolean;
}
