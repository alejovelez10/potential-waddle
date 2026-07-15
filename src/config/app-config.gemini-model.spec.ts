import { appConfig } from './app-config';

describe('appConfig() — gemini.model', () => {
  const originalGeminiModel = process.env.GEMINI_MODEL;

  afterEach(() => {
    // Restore env var after each test
    if (originalGeminiModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = originalGeminiModel;
    }
  });

  it('should return gemini-3.1-flash-lite as default when GEMINI_MODEL is not set', () => {
    delete process.env.GEMINI_MODEL;
    const config = appConfig();
    expect(config.gemini.model).toBe('gemini-3.1-flash-lite');
  });

  it('should return the value of GEMINI_MODEL when it is set', () => {
    process.env.GEMINI_MODEL = 'gemini-custom-model';
    const config = appConfig();
    expect(config.gemini.model).toBe('gemini-custom-model');
  });

  it('should not contain the literal string gemini-2.0-flash in app-config.ts', async () => {
    // Dynamic import to read the source file
    const fs = await import('fs');
    const path = await import('path');
    const configPath = path.resolve(__dirname, 'app-config.ts');
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('gemini-2.0-flash');
  });
});
