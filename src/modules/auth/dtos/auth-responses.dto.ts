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
    fullName: string;
    role: string;
    status: string;
  };
}

export interface ApiResponseMessage {
  message: string;
  success: boolean;
}
