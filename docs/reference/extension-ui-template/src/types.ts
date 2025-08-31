export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  available: boolean;
}

export interface Session {
  id: string;
  title: string;
  lastUsed: Date;
  providers: string[];
  options: {
    research: boolean;
    incognito: boolean;
  };
}