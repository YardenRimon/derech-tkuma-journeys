import {readNativeCartPaymentReceipt,type CartPaymentRuntimeBindings} from './cart-payment-runtime';
import {paymentReceiptResponse,type PaymentReceiptKind,type PaymentReceiptStatus} from './payment-status';
import type {Scope} from './collection-core';
export async function nativePaymentReceiptPage(request:Request,bindings:CartPaymentRuntimeBindings,scope:Scope,kind:PaymentReceiptKind){
 try{const row=await readNativeCartPaymentReceipt(request,bindings,scope);const status:PaymentReceiptStatus=row.monetaryVerified?(row.acknowledgmentConfirmed?'confirmed':'paid_pending_ack'):'pending';return paymentReceiptResponse(kind,status);}
 catch(error){const candidate=(error as {status?:number})?.status,code=[400,403,404,405].includes(candidate??0)?candidate!:503;return paymentReceiptResponse(kind,code===503?'disabled':'unverified',code);}
}
