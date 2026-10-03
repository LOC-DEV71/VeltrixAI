import { forOwner, reserveStorage } from '../services/EntitlementService';
import { PlanError } from '../services/PlanService';
import { Request, Response } from 'express';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import mongoose from 'mongoose';
import { Job } from '../models/Job';

export const updateProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body ?? {};
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id) || typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Tên dự án phải có 1–200 ký tự và ID hợp lệ' } });
    }
    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy dự án' } });
    const workspace = await Workspace.findById(project.workspaceId);
    if (!workspace || String(workspace.ownerId) !== String((req as any).user._id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền sửa dự án' } });
    }
    const updated = await Project.findOneAndUpdate({ _id: project._id }, { $set: { name: name.trim() } }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy dự án' } });
    return res.json({ success: true, data: updated });
  } catch (error) {
    if(error instanceof PlanError)return res.status(error.status).json({success:false,error:{code:error.code}});
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Không thể đổi tên dự án' } });
  }
};

export const deleteProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { confirmName } = req.body ?? {};
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id) || typeof confirmName !== 'string') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Hãy nhập chính xác tên dự án để xóa' } });
    }
    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy dự án' } });
    const workspace = await Workspace.findById(project.workspaceId);
    if (!workspace || String(workspace.ownerId) !== String((req as any).user._id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền xóa dự án' } });
    }
    if (confirmName !== project.name) {
      return res.status(400).json({ success: false, error: { code: 'CONFIRMATION_MISMATCH', message: 'Tên xác nhận không khớp tên dự án' } });
    }
    if (await Job.exists({ 'payload.projectId': { $in: [project._id, String(project._id)] }, status: { $in: ['QUEUED', 'PROCESSING'] } })) {
      return res.status(409).json({ success: false, error: { code: 'PROJECT_BUSY', message: 'Dự án đang xử lý tác vụ. Hãy chờ hoàn tất rồi xóa.' } });
    }
    // Match current name atomically so a concurrent rename invalidates confirmation.
    const deleted = await Project.findOneAndUpdate({ _id: project._id, name: confirmName }, { $set: { deletedAt: new Date() } }, { new: true });
    if (!deleted) return res.status(409).json({ success: false, error: { code: 'PROJECT_CHANGED', message: 'Dự án đã thay đổi. Hãy tải lại và xác nhận tên mới.' } });
    return res.json({ success: true, data: { id: String(project._id) } });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Không thể xóa dự án' } });
  }
};

export const createProject = async (req: Request, res: Response) => {
  try {
    const { name, workspaceId } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'name must contain 1–200 characters' } });
    }
    if (workspaceId !== undefined && (typeof workspaceId !== 'string' || !mongoose.isObjectIdOrHexString(workspaceId))) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid workspaceId' } });
    }
    const userId = (req as any).user._id;
    const session=await mongoose.startSession();let project:any;
    try {await session.withTransaction(async()=>{
      const snapshot=await forOwner(userId,session);let workspace;
      if(workspaceId){workspace=await Workspace.findOne({_id:workspaceId,ownerId:userId}).session(session);if(!workspace)throw new PlanError('NOT_FOUND',404);}
      else {workspace=await Workspace.findOne({ownerId:userId}).sort({createdAt:1}).session(session);if(!workspace){await reserveStorage(userId,snapshot,'workspaces',session);[workspace]=await Workspace.create([{ownerId:userId,name:'My Workspace'}],{session});}}
      await reserveStorage(userId,snapshot,'projects',session);[project]=await Project.create([{workspaceId:workspace._id,name:name.trim()}],{session});
    });}finally{await session.endSession();}
    return res.status(201).json({ success: true, data: project });
  } catch (error) {
    if(error instanceof PlanError)return res.status(error.status).json({success:false,error:{code:error.code}});
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to create project' } });
  }
};

export const getProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid project id' } });
    }
    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    const workspace = await Workspace.findById(project.workspaceId);
    if (!workspace || workspace.ownerId.toString() !== (req as any).user._id.toString()) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this project' } });
    }
    return res.json({ success: true, data: project });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to load project' } });
  }
};

export const getProjects = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const page = Number(req.query.page || 1);
    const limit = 10;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return res.status(400).json({ success: false, error: { code: 'INVALID_PAGINATION', message: 'Trang không hợp lệ' } });

    // Find workspaces owned by user
    const workspaces = await Workspace.find({ ownerId: userId }).select('_id');
    const workspaceIds = workspaces.map(w => w._id);

    const filter = { workspaceId: { $in: workspaceIds } };

    const projects = await Project.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Project.countDocuments(filter);

    res.json({
      success: true,
      data: projects,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};
