/** Vertex embeddings are generated outside DB transactions to avoid holding
 * row locks while waiting for a remote model. All records remain tenant-scoped. */
export const EMBEDDING_DIMENSION = 768;
export interface EmbeddingProvider { modelId: string; embed(text: string, task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]>; }
export function validateEmbedding(value: unknown, dimension=EMBEDDING_DIMENSION): number[] {
  if (!Array.isArray(value) || value.length !== dimension ||
    value.some(v => typeof v !== "number" || !Number.isFinite(v)))
    throw Error("Invalid embedding dimensions or numeric values");
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm < 1e-8) throw Error("Invalid zero-length embedding");
  return value as number[];
}
export function vectorSql(value: number[]): string {
  validateEmbedding(value);
  return `[${value.join(",")}]`;
}
/** Keep the exact serialized representation used at save and retrieval time. */
export function memoryEmbeddingText(key: string, value: Record<string,unknown>): string {
  return `${key}\n${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}: ${String(v)}`).join("\n")}`.slice(0,8_192);
}
/** A stalled Vertex request otherwise waits for undici's 300 s header timeout,
 * outliving the turn's deadline while the room shows "reading…". */
export async function withEmbeddingTimeout<T>(run:(signal:AbortSignal)=>Promise<T>,timeoutMs=15_000,attempts=2):Promise<T> {
  for(let attempt=1;;attempt++){
    try{return await run(AbortSignal.timeout(timeoutMs));}
    catch(error){if(attempt>=attempts)throw error;}
  }
}
export async function createVertexEmbedder(): Promise<EmbeddingProvider> {
  const apiKey=process.env.GEMINI_API_KEY;
  const project=process.env.GCP_PROJECT_ID;
  const location=process.env.GOOGLE_CLOUD_REGION;
  const modelId=process.env.VERTEX_EMBEDDING_MODEL_ID||process.env.GEMINI_EMBEDDING_MODEL_ID||"gemini-embedding-001";
  if(!apiKey&&(!project||!location))throw Error("Vertex embedding project/region/model required");
  const path="@google/genai"; const {GoogleGenAI}=await import(path);
  const genai=apiKey?new GoogleGenAI({apiKey}):new GoogleGenAI({vertexai:true,project,location});
  return {modelId,async embed(text,task){
    const config = apiKey
      ? { taskType: task, outputDimensionality: EMBEDDING_DIMENSION }
      : { taskType: task, outputDimensionality: EMBEDDING_DIMENSION, autoTruncate: false };
    const result=await withEmbeddingTimeout<{embeddings?:Array<{values?:number[]}>}>(signal=>genai.models.embedContent({model:modelId,contents:text,config:{...config,abortSignal:signal}}));
    return validateEmbedding(result.embeddings?.[0]?.values);
  }};
}
