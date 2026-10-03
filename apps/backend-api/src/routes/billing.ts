import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';
import { BillingError, PlanError, billingCapabilities, savedPaymentMethods, checkoutQuote, requireBillingGateway } from '../services/BillingService';
import {createCheckout,receiveIPN,subscriptions,selectSubscription} from '../services/BillingService';
import {BillingOrder} from '../models/BillingOrder';
import {vnPayConfig,verifyCallback} from '../services/VNPayProvider';
import {setupCard,tokenIPN,verifyToken,CardSetup} from '../services/VNPayCards';
import {orderHistory} from '../services/BillingHistory';
const router=Router();
const route=(handler:any)=>(req:any,res:any)=>Promise.resolve(handler(req,res)).catch(error=>res.status(error instanceof BillingError || error instanceof PlanError ? error.status : 500).json({success:false,error:{code:error instanceof BillingError || error instanceof PlanError ? error.code : 'BILLING_UNAVAILABLE'}}));
router.get('/config',(_req,res)=>res.json({success:true,data:billingCapabilities()}));
router.get('/orders',requireAuth,route(async(req:any,res:any)=>{res.setHeader('Cache-Control','no-store');res.json({success:true,data:await orderHistory(req.query,req.user._id)});}));
router.get('/subscriptions',requireAuth,route(async(req:any,res:any)=>{res.setHeader('Cache-Control','no-store');res.json({success:true,data:await subscriptions(req.user._id,req.query)});}));
router.post('/subscriptions/:id/select',requireAuth,csrfProtection,route(async(req:any,res:any)=>{if(!req.body||Object.keys(req.body).some(k=>k!=='expectedCurrentId'))throw new BillingError('BILLING_INVALID_INPUT');res.json({success:true,data:await selectSubscription(req.user._id,req.params.id,req.body.expectedCurrentId)});}));
router.get('/vnpay/token/ipn',async(req,res)=>{try{res.json(req.query.vnp_command==='token_pay'?await receiveIPN(req.query,true):await tokenIPN(req.query));}catch{res.json({RspCode:'99',Message:'Retry later'});}});
router.get('/vnpay/token/return',(req,res)=>{
  const config=vnPayConfig(),p=verifyToken(req.query);if(!config||!p||!/^[a-f0-9]{24}$/.test(p.vnp_txn_ref||''))return res.status(400).json({success:false,error:{code:'BILLING_INVALID_CALLBACK'}});
  const url=new URL('/account/billing',config.clientUrl);url.searchParams.set(p.vnp_command==='token_pay'?'order':'setup',p.vnp_txn_ref);res.redirect(303,url.href);
});
router.get('/payment-methods/setup/:id',requireAuth,route(async(req:any,res:any)=>{
  if(!/^[a-f0-9]{24}$/.test(req.params.id))throw new BillingError('BILLING_ORDER_NOT_FOUND',404);
  const setup=await CardSetup.findOne({_id:req.params.id,ownerId:req.user._id}).select('_id status expiresAt').lean();if(!setup)throw new BillingError('BILLING_ORDER_NOT_FOUND',404);res.json({success:true,data:setup});
}));
router.get('/vnpay/ipn',async(req,res)=>{try{res.json(await receiveIPN(req.query));}catch{res.json({RspCode:'99',Message:'Retry later'});}});
router.get('/vnpay/return',(req,res)=>{
  const config=vnPayConfig();if(!config)return res.status(503).json({success:false,error:{code:'PAYMENT_PROVIDER_UNAVAILABLE'}});
  const params=verifyCallback(req.query,config);if(!params||!/^[a-f0-9]{24}$/.test(params.vnp_TxnRef||''))return res.status(400).json({success:false,error:{code:'BILLING_INVALID_CALLBACK'}});
  const target=new URL('/account/billing',config.clientUrl);target.searchParams.set('order',params.vnp_TxnRef);res.redirect(303,target.href);
});
router.get('/orders/:id',requireAuth,route(async(req:any,res:any)=>{
  if(!/^[a-f0-9]{24}$/.test(req.params.id))throw new BillingError('BILLING_ORDER_NOT_FOUND',404);
  const order=await BillingOrder.findOne({_id:req.params.id,ownerId:req.user._id}).select('_id tier amount billingCycle status createdAt paidAt expiresAt mode').lean();
  if(!order)throw new BillingError('BILLING_ORDER_NOT_FOUND',404);
  res.json({success:true,data:order});
}));
router.get('/payment-methods',requireAuth,route(async(req:any,res:any)=>res.json({success:true,data:{methods:await savedPaymentMethods(req.user._id)}})));
router.post('/payment-methods/setup',requireAuth,csrfProtection,route(async(req:any,res:any)=>{
  if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).some(k=>k!=='consent') || req.body.consent!==true)throw new BillingError('BILLING_CONSENT_REQUIRED');
  res.json({success:true,data:await setupCard(req.user._id,req.ip||'127.0.0.1')});
}));
router.post('/checkout',requireAuth,csrfProtection,route(async(req:any,res:any)=>{
  res.json({success:true,data:await createCheckout(req.user._id,req.body,req.get('Idempotency-Key'),req.ip||'127.0.0.1')});
}));
export default router;
