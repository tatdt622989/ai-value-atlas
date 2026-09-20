import type {RankedValueQuote} from './value';

export type CompleteValueQuote=RankedValueQuote & {recommendation:RankedValueQuote['recommendation'] & {score:number}};

/** Hide incomplete presentation rows without removing their source records. */
export function isCompleteValueQuote(quote:RankedValueQuote):quote is CompleteValueQuote{
 return quote.dataStatus!=='historical'&&Number.isFinite(quote.multiplier)&&quote.multiplier>0
  &&quote.recommendation.score!==null&&Number.isFinite(quote.recommendation.score)
  &&quote.recommendation.score>=0&&quote.recommendation.score<=100;
}
