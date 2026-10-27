export type SimilarVector = number[];

export function meanVector(vectors: SimilarVector[]): SimilarVector | null {
  if (!vectors.length) return null;
  const length = vectors[0].length;
  if (!length || vectors.some((vector) => vector.length !== length)) return null;
  const mean = Array.from({ length }, () => 0);
  for (const vector of vectors) for (let index = 0; index < length; index += 1) mean[index] += vector[index];
  return mean.map((value) => value / vectors.length);
}

export function cosineSimilarity(left: SimilarVector, right: SimilarVector) {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0,
    leftNorm = 0,
    rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export type SimilarRuleProperty = {
  id: string;
  district?: string | null;
  property_type?: string | null;
  transaction_type?: string | null;
  price?: number | null;
};
export function ruleSimilarProperties(source: SimilarRuleProperty, candidates: SimilarRuleProperty[]) {
  return candidates.filter(
    (candidate) =>
      candidate.id !== source.id &&
      candidate.district === source.district &&
      candidate.property_type === source.property_type &&
      candidate.transaction_type === source.transaction_type &&
      source.price != null &&
      candidate.price != null &&
      candidate.price >= source.price * 0.7 &&
      candidate.price <= source.price * 1.3,
  );
}
