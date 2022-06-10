/*
    Copyright 2021 0kims association.

    This file is part of snarkjs.

    snarkjs is a free software: you can redistribute it and/or
    modify it under the terms of the GNU General Public License as published by the
    Free Software Foundation, either version 3 of the License, or (at your option)
    any later version.

    snarkjs is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
    more details.

    You should have received a copy of the GNU General Public License along with
    snarkjs. If not, see <https://www.gnu.org/licenses/>.
*/

/* Implementation of this paper: https://eprint.iacr.org/2019/953.pdf */
import { Scalar } from "ffjavascript";
import * as curves from "./curves.js";
import {  utils }   from "ffjavascript";
const {unstringifyBigInts} = utils;
import jsSha3 from "js-sha3";
import FactoryCG from "./custom_gates/cg_factory.js";
const { keccak256 } = jsSha3;


export default async function plonkVerify(_vk_verifier, _publicSignals, _proof, logger) {
    let vk_verifier = unstringifyBigInts(_vk_verifier);
    let proof = unstringifyBigInts(_proof);
    let publicSignals = unstringifyBigInts(_publicSignals);

    const curve = await curves.getCurveFromName(vk_verifier.curve);

    const Fr = curve.Fr;
    const G1 = curve.G1;

    proof = fromObjectProof(curve, proof);

    vk_verifier = fromObjectVk(curve, vk_verifier, proof.useCustomGates);


    if (!isWellConstructed(curve, proof)) {
        logger.error("Proof is not well constructed");
        return false;
    }
    if (publicSignals.length != vk_verifier.nPublic) {
        logger.error("Invalid number of public inputs");
        return false;
    }
    const challenges = calculateChallenges(curve, proof, publicSignals);
    if (logger) {
        logger.debug("beta: " + Fr.toString(challenges.beta, 16));
        logger.debug("gamma: " + Fr.toString(challenges.gamma, 16));
        logger.debug("alpha: " + Fr.toString(challenges.alpha, 16));
        logger.debug("xi: " + Fr.toString(challenges.xi, 16));
        logger.debug("v1: " + Fr.toString(challenges.v[1], 16));
        logger.debug("v6: " + Fr.toString(challenges.v[6], 16));
        logger.debug("u: " + Fr.toString(challenges.u, 16));
    }
    const L = calculateLagrangeEvaluations(curve, challenges, vk_verifier);
    if (logger) {
        logger.debug("Lagrange Evaluations: ");
        for (let i=1; i<L.length; i++) {
            logger.debug(`L${i}(xi)=` + Fr.toString(L[i], 16));    
        }
    }
    
    if (publicSignals.length != vk_verifier.nPublic) {
        logger.error("Number of public signals does not match with vk");
        return false;
    }

    const pl = calculatePl(curve, publicSignals, L);
    if (logger) {
        logger.debug("Pl: " + Fr.toString(pl, 16));
    }

    const t = calculateT(curve, proof, challenges, pl, L[1]);
    if (logger) {
        logger.debug("t: " + Fr.toString(t, 16));
    }

    const D = calculateD(curve, proof, challenges, vk_verifier, L[1]);
    if (logger) {
        logger.debug("D: " + G1.toString(G1.toAffine(D), 16));
    }

    const F = calculateF(curve, proof, challenges, vk_verifier, D);
    if (logger) {
        logger.debug("F: " + G1.toString(G1.toAffine(F), 16));
    }

    const E = calculateE(curve, proof, challenges, vk_verifier, t);
    if (logger) {
        logger.debug("E: " + G1.toString(G1.toAffine(E), 16));
    }

    const res = await isValidPairing(curve, proof, challenges, vk_verifier, E, F);

    let cgRes = true;
    if(proof.customGates) {
        for (let i = 0; i < proof.customGates.gates.length; i++) {
            cgRes = cgRes && proof.customGates.gates[i].verifyProof(proof.customGates.proof[i], curve.Fr);
        }
    }

    if(logger) logger.info("Custom gates result: " + (cgRes ? "Ok!" : "Error"));

    if (logger) {
        if (res) {
            logger.info("OK!");
        } else {
            logger.warn("Invalid Proof");
        }
    }

    if (logger) logger.info("Plonk verifier finished");

    return res;

}


function fromObjectProof(curve, proof) {
    const G1 = curve.G1;
    const Fr = curve.Fr;
    const res = {};
    res.A = G1.fromObject(proof.A);
    res.B = G1.fromObject(proof.B);
    res.C = G1.fromObject(proof.C);
    res.Z = G1.fromObject(proof.Z);
    res.T1 = G1.fromObject(proof.T1);
    res.T2 = G1.fromObject(proof.T2);
    res.T3 = G1.fromObject(proof.T3);
    res.eval_a = Fr.fromObject(proof.eval_a);
    res.eval_b = Fr.fromObject(proof.eval_b);
    res.eval_c = Fr.fromObject(proof.eval_c);
    res.eval_zw = Fr.fromObject(proof.eval_zw);
    res.eval_s1 = Fr.fromObject(proof.eval_s1);
    res.eval_s2 = Fr.fromObject(proof.eval_s2);
    res.eval_r = Fr.fromObject(proof.eval_r);
    res.Wxi = G1.fromObject(proof.Wxi);
    res.Wxiw = G1.fromObject(proof.Wxiw);

    res.useCustomGates = undefined !== proof["customGates"] ;

    if (res.useCustomGates) {
        const length = proof.customGates.length;
        res.customGates = {};

        res.customGates.gates = Array(length);
        for (let i = 0; i < length; i++) {
            //create gates
            res.customGates.gates[i] = FactoryCG.create(proof.customGates[i].id, {});
        }

        //get custom gate proof
        res.customGates.proof = Array(length);
        for (let i = 0; i < length; i++) {
            res.customGates.proof[i] = res.customGates.gates[i].fromObjectProof(proof.customGates[i].proof, curve);
        }
    }
    return res;
}

function fromObjectVk(curve, vk, useCustomGates) {
    const G1 = curve.G1;
    const G2 = curve.G2;
    const Fr = curve.Fr;
    const res = vk;
    res.Qm = G1.fromObject(vk.Qm);
    res.Ql = G1.fromObject(vk.Ql);
    res.Qr = G1.fromObject(vk.Qr);
    res.Qo = G1.fromObject(vk.Qo);
    res.Qc = G1.fromObject(vk.Qc);

    if (useCustomGates) {
        for (let i = 0; i < vk.Qk.length; i++) {
            res.Qk[i] = G1.fromObject(vk.Qk[i]);
        }
    }

    res.S1 = G1.fromObject(vk.S1);
    res.S2 = G1.fromObject(vk.S2);
    res.S3 = G1.fromObject(vk.S3);
    res.k1 = Fr.fromObject(vk.k1);
    res.k2 = Fr.fromObject(vk.k2);
    res.X_2 = G2.fromObject(vk.X_2);

    return res;
}

function isWellConstructed(curve, proof) {
    const G1 = curve.G1;
    if (!G1.isValid(proof.A)) return false;
    if (!G1.isValid(proof.B)) return false;
    if (!G1.isValid(proof.C)) return false;
    if (!G1.isValid(proof.Z)) return false;
    if (!G1.isValid(proof.T1)) return false;
    if (!G1.isValid(proof.T2)) return false;
    if (!G1.isValid(proof.T3)) return false;
    if (!G1.isValid(proof.Wxi)) return false;
    if (!G1.isValid(proof.Wxiw)) return false;
    return true;
}

function calculateChallenges(curve, proof, publicSignals) {
    const G1 = curve.G1;
    const Fr = curve.Fr;
    const n8r = curve.Fr.n8;
    const res = {};

    const transcript1 = new Uint8Array(publicSignals.length*n8r + G1.F.n8*2*3);
    for (let i=0; i<publicSignals.length; i++) {
        Fr.toRprBE(transcript1, i*n8r, Fr.e(publicSignals[i]));
    }
    G1.toRprUncompressed(transcript1, publicSignals.length*n8r + 0, proof.A);
    G1.toRprUncompressed(transcript1, publicSignals.length*n8r + G1.F.n8*2, proof.B);
    G1.toRprUncompressed(transcript1, publicSignals.length*n8r + G1.F.n8*4, proof.C);

    res.beta = hashToFr(curve, transcript1);

    const transcript2 = new Uint8Array(n8r);
    Fr.toRprBE(transcript2, 0, res.beta);
    res.gamma = hashToFr(curve, transcript2);

    const transcript3 = new Uint8Array(G1.F.n8*2);
    G1.toRprUncompressed(transcript3, 0, proof.Z);
    res.alpha = hashToFr(curve, transcript3);

    const transcript4 = new Uint8Array(G1.F.n8*2*3);
    G1.toRprUncompressed(transcript4, 0, proof.T1);
    G1.toRprUncompressed(transcript4, G1.F.n8*2, proof.T2);
    G1.toRprUncompressed(transcript4, G1.F.n8*4, proof.T3);
    res.xi = hashToFr(curve, transcript4);

    const transcript5 = new Uint8Array(n8r*7);
    Fr.toRprBE(transcript5, 0, proof.eval_a);
    Fr.toRprBE(transcript5, n8r, proof.eval_b);
    Fr.toRprBE(transcript5, n8r*2, proof.eval_c);
    Fr.toRprBE(transcript5, n8r*3, proof.eval_s1);
    Fr.toRprBE(transcript5, n8r*4, proof.eval_s2);
    Fr.toRprBE(transcript5, n8r*5, proof.eval_zw);
    Fr.toRprBE(transcript5, n8r*6, proof.eval_r);
    res.v = [];
    res.v[1] = hashToFr(curve, transcript5);

    for (let i=2; i<=6; i++ ) res.v[i] = Fr.mul(res.v[i-1], res.v[1]);

    const transcript6 = new Uint8Array(G1.F.n8*2*2);
    G1.toRprUncompressed(transcript6, 0, proof.Wxi);
    G1.toRprUncompressed(transcript6, G1.F.n8*2, proof.Wxiw);
    res.u = hashToFr(curve, transcript6);

    return res;
}

function calculateLagrangeEvaluations(curve, challenges, vk) {
    const Fr = curve.Fr;

    let xin = challenges.xi;
    let domainSize = 1;
    for (let i=0; i<vk.power; i++) {
        xin = Fr.square(xin);
        domainSize *= 2;
    }
    challenges.xin = xin;

    challenges.zh = Fr.sub(xin, Fr.one);
    const L = [];

    const n = Fr.e(domainSize);
    let w = Fr.one;
    for (let i=1; i<=Math.max(1, vk.nPublic); i++) {
        L[i] = Fr.div(Fr.mul(w, challenges.zh), Fr.mul(n, Fr.sub(challenges.xi, w)));
        w = Fr.mul(w, Fr.w[vk.power]);
    }

    return L;
}

function hashToFr(curve, transcript) {
    const v = Scalar.fromRprBE(new Uint8Array(keccak256.arrayBuffer(transcript)));
    return curve.Fr.e(v);
}

function calculatePl(curve, publicSignals, L) {
    const Fr = curve.Fr;

    let pl = Fr.zero;
    for (let i=0; i<publicSignals.length; i++) {
        const w = Fr.e(publicSignals[i]);
        pl = Fr.sub(pl, Fr.mul(w, L[i+1]));
    }
    return pl;
}

function calculateT(curve, proof, challenges, pl, l1) {
    const Fr = curve.Fr;
    let num = proof.eval_r;
    num = Fr.add(num, pl);

    let e1 = proof.eval_a;
    e1 = Fr.add(e1, Fr.mul(challenges.beta, proof.eval_s1));
    e1 = Fr.add(e1, challenges.gamma);

    let e2 = proof.eval_b;
    e2 = Fr.add(e2, Fr.mul(challenges.beta, proof.eval_s2));
    e2 = Fr.add(e2, challenges.gamma);

    let e3 = proof.eval_c;
    e3 = Fr.add(e3, challenges.gamma);

    let e = Fr.mul(Fr.mul(e1, e2), e3);
    e = Fr.mul(e, proof.eval_zw);
    e = Fr.mul(e, challenges.alpha);

    num = Fr.sub(num, e);

    num = Fr.sub(num, Fr.mul(l1, Fr.square(challenges.alpha)));

    const t = Fr.div(num, challenges.zh);

    return t;
}

function calculateD(curve, proof, challenges, vk, l1) {
    const G1 = curve.G1;
    const Fr = curve.Fr;

    let s1 = Fr.mul(Fr.mul(proof.eval_a, proof.eval_b), challenges.v[1]);
    let res = G1.timesFr(vk.Qm, s1);

    if (proof.useCustomGates) {
        for (let i = 0; i < proof.customGates.gates.length; i++) {
            const plonkFactor = proof.customGates.gates[i].plonkFactor(
                Fr.mul(proof.eval_a, challenges.v[1]),
                Fr.mul(proof.eval_b, challenges.v[1]),
                Fr.mul(proof.eval_c, challenges.v[1]),
                Fr
            );
            res = G1.add(res, G1.timesFr(vk.Qk[i], plonkFactor));
        }
    }

    let s2 = Fr.mul(proof.eval_a, challenges.v[1]);
    res = G1.add(res, G1.timesFr(vk.Ql, s2));

    let s3 = Fr.mul(proof.eval_b, challenges.v[1]);
    res = G1.add(res, G1.timesFr(vk.Qr, s3));

    let s4 = Fr.mul(proof.eval_c, challenges.v[1]);
    res = G1.add(res, G1.timesFr(vk.Qo, s4));

    res = G1.add(res, G1.timesFr(vk.Qc, challenges.v[1]));

    const betaxi = Fr.mul(challenges.beta, challenges.xi);
    let s6a = proof.eval_a;
    s6a = Fr.add(s6a, betaxi);
    s6a = Fr.add(s6a, challenges.gamma);

    let s6b = proof.eval_b;
    s6b = Fr.add(s6b, Fr.mul(betaxi, vk.k1));
    s6b = Fr.add(s6b, challenges.gamma);

    let s6c = proof.eval_c;
    s6c = Fr.add(s6c, Fr.mul(betaxi, vk.k2));
    s6c = Fr.add(s6c, challenges.gamma);

    let s6 = Fr.mul(Fr.mul(s6a, s6b), s6c);
    s6 = Fr.mul(s6, Fr.mul(challenges.alpha, challenges.v[1]));

    let s6d = Fr.mul(Fr.mul(l1, Fr.square(challenges.alpha)), challenges.v[1]);
    s6 = Fr.add(s6, s6d);

    s6 = Fr.add(s6, challenges.u);
    res = G1.add(res, G1.timesFr(proof.Z, s6));


    let s7a = proof.eval_a;
    s7a = Fr.add(s7a, Fr.mul(challenges.beta, proof.eval_s1));
    s7a = Fr.add(s7a, challenges.gamma);

    let s7b = proof.eval_b;
    s7b = Fr.add(s7b, Fr.mul(challenges.beta, proof.eval_s2));
    s7b = Fr.add(s7b, challenges.gamma);

    let s7 = Fr.mul(s7a, s7b);
    s7 = Fr.mul(s7, challenges.alpha);
    s7 = Fr.mul(s7, challenges.v[1]);
    s7 = Fr.mul(s7, challenges.beta);
    s7 = Fr.mul(s7, proof.eval_zw);
    res = G1.sub(res, G1.timesFr(vk.S3, s7));

    return res;
}

function calculateF(curve, proof, challanges, vk, D) {
    const G1 = curve.G1;
    const Fr = curve.Fr;

    let res = proof.T1;

    res = G1.add(res, G1.timesFr(proof.T2, challanges.xin));
    res = G1.add(res, G1.timesFr(proof.T3, Fr.square(challanges.xin)));
    res = G1.add(res, D);
    res = G1.add(res, G1.timesFr(proof.A, challanges.v[2]));
    res = G1.add(res, G1.timesFr(proof.B, challanges.v[3]));
    res = G1.add(res, G1.timesFr(proof.C, challanges.v[4]));
    res = G1.add(res, G1.timesFr(vk.S1, challanges.v[5]));
    res = G1.add(res, G1.timesFr(vk.S2, challanges.v[6]));

    return res;
}


function calculateE(curve, proof, challanges, vk, t) {
    const G1 = curve.G1;
    const Fr = curve.Fr;

    let s = t;

    s = Fr.add(s, Fr.mul(challanges.v[1], proof.eval_r));
    s = Fr.add(s, Fr.mul(challanges.v[2], proof.eval_a));
    s = Fr.add(s, Fr.mul(challanges.v[3], proof.eval_b));
    s = Fr.add(s, Fr.mul(challanges.v[4], proof.eval_c));
    s = Fr.add(s, Fr.mul(challanges.v[5], proof.eval_s1));
    s = Fr.add(s, Fr.mul(challanges.v[6], proof.eval_s2));
    s = Fr.add(s, Fr.mul(challanges.u, proof.eval_zw));

    const res = G1.timesFr(G1.one, s);

    return res;
}

async function isValidPairing(curve, proof, challanges, vk, E, F) {
    const G1 = curve.G1;
    const Fr = curve.Fr;

    let A1 = proof.Wxi;
    A1 = G1.add(A1, G1.timesFr(proof.Wxiw, challanges.u));

    let B1 = G1.timesFr(proof.Wxi, challanges.xi);
    const s = Fr.mul(Fr.mul(challanges.u, challanges.xi), Fr.w[vk.power]);
    B1 = G1.add(B1, G1.timesFr(proof.Wxiw, s));
    B1 = G1.add(B1, F);
    B1 = G1.sub(B1, E);

    const res = await curve.pairingEq(
        G1.neg(A1) , vk.X_2,
        B1 , curve.G2.one
    );

    return res;

}
