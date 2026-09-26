class_name ProcRig
extends RefCounted
## Procedural animation on a Skeleton3D, written in the model's own axes: +X right, +Y up, -Z forward.
## Each frame: rot()/offset() the bones you want, then apply(); untouched bones return to rest.
## A rotation about +X swings a downward limb forward and lifts a forward-pointing neck.

var skel: Skeleton3D
var _idx := {}
var _rest_rot := []
var _rest_pos := []
var _gr := [] # global rest basis per bone
var _rot := {}
var _pos := {}


func _init(s: Skeleton3D) -> void:
	skel = s
	for i in s.get_bone_count():
		_idx[s.get_bone_name(i)] = i
		var r := s.get_bone_rest(i)
		_rest_rot.append(r.basis.get_rotation_quaternion())
		_rest_pos.append(r.origin)
		_gr.append(s.get_bone_global_rest(i).basis.orthonormalized())


func has(bone: String) -> bool:
	return _idx.has(bone)


## Rotate `bone` by `angle` radians about a model-space axis (combines with earlier calls this frame).
func rot(bone: String, axis: Vector3, angle: float) -> void:
	if not _idx.has(bone) or absf(angle) < 1e-5:
		return
	var i: int = _idx[bone]
	var q := Quaternion(axis.normalized(), angle)
	_rot[i] = q * _rot.get(i, Quaternion.IDENTITY)


## Move `bone` by a model-space offset.
func offset(bone: String, v: Vector3) -> void:
	if _idx.has(bone):
		var i: int = _idx[bone]
		_pos[i] = _pos.get(i, Vector3.ZERO) + v


func apply() -> void:
	for i in _rest_rot.size():
		var local_q: Quaternion = _rest_rot[i]
		if _rot.has(i):
			var gr: Basis = _gr[i]
			local_q = local_q * Quaternion(gr.inverse() * Basis(_rot[i] as Quaternion) * gr)
		skel.set_bone_pose_rotation(i, local_q)
		var p: Vector3 = _rest_pos[i]
		if _pos.has(i):
			var parent := skel.get_bone_parent(i)
			var pb: Basis = _gr[parent] if parent >= 0 else Basis()
			p += pb.inverse() * (_pos[i] as Vector3)
		skel.set_bone_pose_position(i, p)
	_rot.clear()
	_pos.clear()


## Global rest position of a bone (model space), for attaching eyes and effects.
func rest_origin(bone: String) -> Vector3:
	return skel.get_bone_global_rest(_idx[bone]).origin if _idx.has(bone) else Vector3.ZERO
